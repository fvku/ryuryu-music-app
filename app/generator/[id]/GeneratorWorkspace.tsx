"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canvasPreviewPage, type CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorSnapshot } from "@/lib/generator/client-types";
import type { GeneratorDocument, ItemContent } from "@/lib/generator/model";
import type { ReimportDiff } from "@/lib/generator/reimport";
import type { ReleaseMasterAlbum } from "@/lib/types";
import BulkExportButton from "../BulkExportButton";
import GeneratorPreview, { type PreviewDiagnostics, type PreviewSelection } from "../GeneratorPreview";
import PageNavigator from "../PageNavigator";
import { generatorJson, snapshotWithLocks, type GeneratorApiError } from "../generator-client";
import { CoverColorProbe } from "../cover-color-client";
import { GeneratorRuntimeProvider } from "../runtime";
import { Chip, Panel, PrimaryButton, SecondaryButton, SegmentedControl, SelectInput, StatusBanner, useMediaQuery, type SegmentOption } from "../ui";
import { PageInspector, RestoreControl, StructureDialog, type TargetState } from "./Inspectors";
import ItemInspector from "./ItemInspector";
import ReimportDialog from "./ReimportDialog";
import SourceRefreshDialog from "./SourceRefreshDialog";
import { clearRecovery, hasRecovery, readRecovery, writeRecovery } from "./recovery";
import { useGeneratorSession } from "./session";
import { applySourceRefresh, collectSourceRefresh, indexAlbums, matchAlbum, type RefreshFieldKey, type SourceRefreshItem } from "./source-refresh";
import {
  cloneContent,
  derivePageBadges,
  imageSaveTargets,
  keyOf,
  lockPayload,
  same,
  targetLabels,
  type ActiveLock,
  type FieldSelection,
  type LockKind,
} from "./workspace-types";

/** 編集パネルは「情報修正／背景設定」の2つ。共通設定は画像に属さないので別画面にした。 */
type PanelKey = "info" | "background";

const seriesLabels: Record<GeneratorDocument["series"], string> = {
  monthly: "Monthly Review",
  japan: "Monthly Japan Review",
  weekly: "Weekly Review",
};

const FALLBACK_PAGE_COLOR = "#475569";
const savedAtFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" });

function periodLabel(document: GeneratorDocument): string {
  if (document.series !== "weekly") return document.period.start.slice(0, 7);
  const source = new Date(`${document.period.start}T00:00:00.000Z`), thursday = new Date(source);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear(), yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year} WEEK ${document.period.weekNumber ?? week} · ${document.period.start}`;
}

export default function GeneratorWorkspace({ initialSnapshot, actor }: { initialSnapshot: GeneratorSnapshot; actor: string }) {
  const session = useGeneratorSession({ initialSnapshot, actor });
  const { snapshot, setSnapshot, documentId, busy, setBusy, status, setStatus, activeLocks, locksRef, history, pendingSaves } = session;

  const [pageIndex, setPageIndex] = useState(0), [panel, setPanel] = useState<PanelKey>("info");
  const [slotIndex, setSlotIndex] = useState(0), [reorderOpen, setReorderOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ItemContent>>({});
  const [pageColors, setPageColors] = useState<Record<string, string>>({});
  const [structurePages, setStructurePages] = useState<GeneratorDocument["pages"] | null>(null);
  const [refreshResults, setRefreshResults] = useState<SourceRefreshItem[] | null>(null);
  const [reimportDiff, setReimportDiff] = useState<ReimportDiff | null>(null);
  const [diagnostics, setDiagnostics] = useState<PreviewDiagnostics | null>(null);
  const [selectionState, setSelectionState] = useState<FieldSelection | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState("このブラウザ内の復旧保存を準備しています…");
  /** 編集中の画像。画像ごとに「編集」で始め、「編集を終了」で終わる。 */
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  /** ジャケットから拾った背景色の候補。画像ごとに1度だけ計算する。 */
  const [colorCandidates, setColorCandidates] = useState<Record<string, string[]>>({});
  const durationHydratedDocument = useRef<string | null>(null);

  const wide = useMediaQuery("(min-width: 1280px)");
  // iPhoneでは字間の調整を出さない（範囲選択がページのスクロールと両立しないため）。
  // 保存済みの tracking / kerns はそのまま描画・保存され続ける。
  const phone = useMediaQuery("(max-width: 639px), (pointer: coarse) and (max-height: 500px)");
  const items = useMemo(() => new Map(snapshot.document.items.map(item => [item.id, item])), [snapshot.document.items]);
  const previewDocument = useMemo<GeneratorDocument>(() => ({
    ...snapshot.document,
    pages: (structurePages || snapshot.document.pages).map(value => ({ ...value, bgColor: pageColors[value.id] ?? value.bgColor })),
    items: snapshot.document.items.map(item => ({ ...item, content: drafts[item.id] || item.content })),
  }), [drafts, pageColors, snapshot.document, structurePages]);
  const previewPages = useMemo(
    () => previewDocument.pages.map((_, index) => canvasPreviewPage(previewDocument, index)).filter((page): page is CanvasPreviewPage => page !== null),
    [previewDocument],
  );
  const currentIndex = Math.min(pageIndex, Math.max(0, previewPages.length - 1));
  const previewPage = previewPages[currentIndex] || null;
  const visiblePages = structurePages || snapshot.document.pages;
  const page = visiblePages[currentIndex] || visiblePages[0];
  const pageItems = page?.itemIds
    .map(id => items.get(id))
    .filter((item): item is GeneratorDocument["items"][number] => Boolean(item)) || [];
  const activeItem = pageItems[Math.min(slotIndex, Math.max(0, pageItems.length - 1))] || null;
  const selection: FieldSelection = selectionState && activeItem && selectionState.itemId === activeItem.id
    ? selectionState
    : { itemId: activeItem?.id || "", slotIndex: 0, key: page?.kind === "adopted" ? "text" : "title", start: 0, end: 0, source: "field" };
  const dirty = !same(previewDocument, snapshot.document);

  const itemDirty = useCallback(
    (id: string) => Boolean(drafts[id]) && !same(drafts[id], items.get(id)?.content),
    [drafts, items],
  );

  // 既存versionの作成後に Release Master の Time が補完された場合も、空欄だけを最新値で下書きへ戻す。
  // 共有DBは自動更新せず、利用者が画像ごとの「保存」でversionとして確定する。
  useEffect(() => {
    if (durationHydratedDocument.current === documentId) return;
    durationHydratedDocument.current = documentId;
    let cancelled = false;
    void fetch("/api/release-master", { cache: "no-store" })
      .then(generatorJson<ReleaseMasterAlbum[]>)
      .then(albums => {
        if (cancelled) return;
        const albumIndex = indexAlbums(albums);
        const durations = new Map<string, string>();
        for (const item of snapshot.document.items) {
          if (item.content.fields.duration.trim()) continue;
          const album = matchAlbum(item, albumIndex);
          if (album?.duration.trim()) durations.set(item.id, album.duration.trim());
        }
        setDrafts(current => {
          const next = { ...current };
          let changed = false;
          for (const item of snapshot.document.items) {
            const base = current[item.id] || item.content;
            if (base.fields.duration.trim()) continue;
            const duration = durations.get(item.id);
            if (!duration) continue;
            next[item.id] = cloneContent(base);
            next[item.id].fields.duration = duration;
            changed = true;
          }
          return changed ? next : current;
        });
        if (durations.size) setStatus({ tone: "success", text: `Release Masterから空欄のTimeを${durations.size}件読み込みました。各画像の「保存」でversionに確定できます。` });
      })
      .catch(() => {
        if (!cancelled) setStatus({ tone: "warn", text: "Release MasterのTimeを再取得できませんでした。ほかの編集機能は利用できます。" });
      });
    return () => { cancelled = true; };
  }, [documentId, setStatus, snapshot.document.items]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecoveryAvailable(hasRecovery(actor, documentId));
      setRecoveryStatus("このブラウザにも復旧用コピーを保存します（共有保存とは別）。");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [actor, documentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!dirty) return;
      if (writeRecovery({ actor, documentId, baseVersion: snapshot.version, document: previewDocument })) {
        setRecoveryAvailable(true);
        setRecoveryStatus(`復旧用コピー保存済み · ${new Date().toLocaleTimeString("ja-JP")}（共有保存なし）`);
      } else {
        setRecoveryStatus("復旧用コピーを保存できませんでした。共有DBには未保存です。");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [actor, dirty, documentId, previewDocument, snapshot.version]);

  // 背景色の候補はジャケットの画素から拾う。表紙は作品を持たないので、最初のメインのジャケットを使う。
  const colorSource = previewPage?.kind === "cover" ? previewPages.find(value => value.kind === "feature") || null : previewPage;
  const rememberColors = useCallback((pageId: string, colors: string[]) => {
    setColorCandidates(current => current[pageId] ? current : { ...current, [pageId]: colors });
  }, []);

  const handleDiagnostics = useCallback((value: PreviewDiagnostics) => setDiagnostics(value), []);

  async function reload() {
    setBusy(true);
    const next = await session.fetchSnapshot();
    if (next) {
      durationHydratedDocument.current = null;
      setSnapshot(next);
      setEditingPageId(null);
      setDrafts({});
      setPageColors({});
      setStructurePages(null);
      setRefreshResults(null);
      setReimportDiff(null);
      pendingSaves.clear();
      setStatus({ tone: "success", text: "最新版を読み込みました。編集中だった内容は破棄されています。" });
    }
    setBusy(false);
  }

  /** その画像で自分が持っているロック。画像を離れるとき・編集を終えるときにまとめて返す。 */
  function locksForPage(pageId: string): ActiveLock[] {
    const target = (structurePages || snapshot.document.pages).find(value => value.id === pageId);
    if (!target) return [];
    return Object.values(locksRef.current).filter(lock =>
      (lock.kind === "page" && lock.targetId === pageId) || (lock.kind === "item" && target.itemIds.includes(lock.targetId)));
  }

  function pageHasUnsaved(pageId: string): boolean {
    const target = (structurePages || snapshot.document.pages).find(value => value.id === pageId);
    if (!target) return false;
    return imageSaveTargets({
      page: target,
      savedBgColor: snapshot.document.pages.find(value => value.id === pageId)?.bgColor ?? null,
      pageColors,
      titleOf: id => items.get(id)?.content.fields.title || "",
      isItemDirty: itemDirty,
    }).length > 0;
  }

  /** 画像の編集を開始する。背景と、いま選んでいる作品のロックを取る。 */
  async function beginImageEdit() {
    if (!page) return;
    setStatus({ tone: "info", text: "編集ロックを取得しています…" });
    const pageLock = await session.acquire("page", page.id);
    if (!pageLock) return;
    // 背景色が未設定の画像は、ジャケットから拾った候補の先頭を初期値にする。
    // 決めるのは人なので、そのまま保存もできるし、候補やカラーピッカーで直してもよい。
    const savedColor = snapshot.document.pages.find(value => value.id === page.id)?.bgColor ?? null;
    setPageColors(current => current[page.id] !== undefined
      ? current
      : { ...current, [page.id]: savedColor ?? colorCandidates[page.id]?.[0] ?? FALLBACK_PAGE_COLOR });
    if (activeItem) {
      const itemLock = await session.acquire("item", activeItem.id);
      if (itemLock) {
        setDrafts(current => current[activeItem.id] ? current : { ...current, [activeItem.id]: cloneContent(activeItem.content) });
      }
    }
    setEditingPageId(page.id);
    setStatus({ tone: "success", text: "この画像を編集できます。ロックは操作中、自動で延長されます。" });
  }

  async function endImageEdit(pageId: string, quiet = false) {
    const held = locksForPage(pageId);
    if (held.length) await session.releaseMany(held);
    setEditingPageId(current => current === pageId ? null : current);
    if (!quiet) setStatus({ tone: "info", text: "この画像の編集を終了しました。他の人が編集できます。" });
  }

  // 編集中に別の作品へ切り替えたら、その作品のロックも取る（1画像の中で続けて直せるようにする）。
  useEffect(() => {
    if (!page || editingPageId !== page.id || !activeItem) return;
    if (locksRef.current[keyOf("item", activeItem.id)]) return;
    let cancelled = false;
    void (async () => {
      const lock = await session.acquire("item", activeItem.id);
      if (cancelled || !lock) return;
      setDrafts(current => current[activeItem.id] ? current : { ...current, [activeItem.id]: cloneContent(activeItem.content) });
    })();
    return () => { cancelled = true; };
  }, [activeItem, editingPageId, locksRef, page, session]);

  /**
   * いま開いている画像を保存する。作品（掲載なら上下、Othersなら触った分）と背景色を続けて確定する。
   * まとめて確定するAPIが無いため、途中で失敗したら成功分はそのまま残し、失敗した対象を知らせて再試行させる。
   */
  async function saveImage() {
    if (!page) return;
    const targets = imageSaveTargets({
      page,
      savedBgColor: snapshot.document.pages.find(value => value.id === page.id)?.bgColor ?? null,
      pageColors,
      titleOf: id => items.get(id)?.content.fields.title || "",
      isItemDirty: itemDirty,
    });
    if (!targets.length) return;
    setBusy(true);
    setStatus({ tone: "info", text: `共有DBへ保存しています…（${targets.length}件）` });
    const saved: string[] = [];
    for (const target of targets) {
      const content = target.kind === "item" ? drafts[target.targetId] : { bgColor: pageColors[page.id] };
      const result = await session.saveTarget({ kind: target.kind, targetId: target.targetId, content });
      if (!result.ok) {
        setBusy(false);
        const remaining = targets.length - saved.length;
        const reason = result.error.code === "VERSION_CONFLICT" || result.error.code === "LOCK_LOST"
          ? "他の変更が先に保存されました。最新版を再読込してから、もう一度編集してください。"
          : result.error.message;
        setStatus({
          tone: "error",
          text: saved.length
            ? `${saved.join("・")}は保存しました。${target.label}で止まりました（残り${remaining}件）: ${reason}`
            : `${target.label}を保存できませんでした: ${reason}`,
        });
        return;
      }
      saved.push(target.label);
      if (target.kind === "item") {
        const next = result.snapshot.document.items.find(item => item.id === target.targetId);
        if (next) setDrafts(current => ({ ...current, [target.targetId]: cloneContent(next.content) }));
      } else {
        const next = result.snapshot.document.pages.find(value => value.id === target.targetId);
        if (next) setPageColors(current => ({ ...current, [target.targetId]: next.bgColor || FALLBACK_PAGE_COLOR }));
      }
    }
    setBusy(false);
    setStatus({ tone: "success", text: `この画像を保存しました（${saved.join("・")}）。` });
  }

  /** 対象1つだけの保存・復元。並び順モーダルと、過去版からの復元で使う。 */
  async function saveSingle(kind: LockKind, targetId: string, content?: unknown, restoreVersion?: number) {
    setBusy(true);
    setStatus({ tone: "info", text: restoreVersion ? `version ${restoreVersion} の内容を復元しています…` : "共有DBへ保存しています…" });
    const result = await session.saveTarget({ kind, targetId, content, restoreVersion });
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error.code === "VERSION_CONFLICT" || result.error.code === "LOCK_LOST"
        ? { tone: "error", text: "他の変更が先に保存されました。最新版を再読込してから、もう一度編集してください。" }
        : { tone: "error", text: result.error.message });
      return;
    }
    const next = result.snapshot;
    if (kind === "item") {
      const value = next.document.items.find(item => item.id === targetId);
      if (value) setDrafts(current => ({ ...current, [targetId]: cloneContent(value.content) }));
    } else if (kind === "page") {
      const value = next.document.pages.find(entry => entry.id === targetId);
      if (value) setPageColors(current => ({ ...current, [targetId]: value.bgColor || FALLBACK_PAGE_COLOR }));
    } else if (kind === "structure") {
      setStructurePages(next.document.pages.map(value => ({ ...value, itemIds: [...value.itemIds] })));
    }
    setStatus({
      tone: "success",
      text: restoreVersion
        ? `version ${restoreVersion} の${targetLabels[kind]}を、新しいversion ${next.version} として復元しました。`
        : `${targetLabels[kind]}をversion ${next.version} として保存しました。`,
    });
  }

  /**
   * 取り込み後にRelease Master側で直された文字情報を読み直す。
   * 共有DBは触らず、選ばれた項目だけをローカル下書きへ入れる（確定は画像ごとの「保存」）。
   */
  async function refreshFromSource() {
    setBusy(true);
    setStatus({ tone: "info", text: "Release Masterの最新の文字情報を読み込んでいます…" });
    try {
      const albums = await generatorJson<ReleaseMasterAlbum[]>(await fetch("/api/release-master", { cache: "no-store" }));
      const results = collectSourceRefresh({ document: snapshot.document, drafts, albums });
      const total = results.reduce((count, item) => count + item.changes.length, 0);
      const missing = results.filter(item => !item.matched).length;
      setRefreshResults(results);
      setStatus(total
        ? { tone: "warn", text: `Release Masterと違う項目が${total}件あります。取り込む項目を選んでください。` }
        : missing
          ? { tone: "warn", text: `差分はありませんが、Release Masterで照合できない作品が${missing}件あります。` }
          : { tone: "success", text: "Release Masterと同じ内容です。取り込む差分はありません。" });
    } catch (error) {
      setStatus({ tone: "error", text: `Release Masterを読み込めませんでした: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  /** Release Masterの採用状態を読み直し、作品集合の変更案をstructureロック下で確認する。 */
  async function openReimport() {
    if (dirty) {
      setStatus({ tone: "warn", text: "未保存の下書きがあります。先に保存または最新版の再読込を行ってから、取り込み直してください。" });
      return;
    }
    const lock = await session.acquire("structure", documentId);
    if (!lock) return;
    setBusy(true);
    setStatus({ tone: "info", text: "Release Masterから作品の増減と区分を確認しています…" });
    try {
      const diff = await generatorJson<ReimportDiff>(await fetch(`/api/generator/documents/${documentId}/reimport`, { cache: "no-store" }));
      setReimportDiff(diff);
      const count = diff.added.length + diff.removed.length + diff.moved.length;
      setStatus(count
        ? { tone: "warn", text: `作品の追加・削除・区分移動が${count}件あります。実行内容を確認してください。` }
        : { tone: "success", text: "作品の増減・区分移動はありません。" });
    } catch (error) {
      setStatus({ tone: "error", text: `取り込み差分を確認できませんでした: ${(error as Error).message}` });
      await session.release("structure", documentId);
    } finally {
      setBusy(false);
    }
  }

  async function closeReimport() {
    setReimportDiff(null);
    await session.release("structure", documentId);
  }

  async function applyReimport(value: { addKeys: string[]; removeItemIds: string[]; resort: boolean }) {
    const lock = activeLocks[keyOf("structure", documentId)];
    if (!lock) { setStatus({ tone: "warn", text: "取り込み直しの編集ロックを取得し直してください。" }); return; }
    if (dirty) { setStatus({ tone: "warn", text: "未保存の下書きがあるため、取り込み直しを実行できません。" }); return; }
    // 自分が削除対象の作品を開いていた場合、その作品ロックだけを先に返す。
    const doomed = Object.values(locksRef.current).filter(entry => entry.kind === "item" && value.removeItemIds.includes(entry.targetId));
    if (doomed.length) await session.releaseMany(doomed);
    const change = {
      clientId: lock.clientId, token: lock.token, generation: lock.generation,
      expectedVersion: snapshot.structureVersion, addKeys: value.addKeys,
      removeItemIds: value.removeItemIds, resort: value.resort,
    };
    const requestKey = `reimport:${documentId}`, signature = JSON.stringify(change);
    const previousRequest = pendingSaves.get(requestKey);
    const requestId = previousRequest?.signature === signature ? previousRequest.requestId : crypto.randomUUID();
    pendingSaves.set(requestKey, { requestId, signature });
    setBusy(true);
    setStatus({ tone: "info", text: "作品構成を新しいversionとして保存しています…" });
    try {
      const next = await generatorJson<GeneratorSnapshot>(await fetch(`/api/generator/documents/${documentId}/reimport`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, ...change }),
      }));
      pendingSaves.delete(requestKey);
      // 保存済みならstructureロックはもう不要。失敗しても期限切れで解放される。
      await fetch(`/api/generator/documents/${documentId}/locks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", ...lockPayload(lock) }),
      }).catch(() => undefined);
      const removed = new Set(value.removeItemIds);
      const retainedLocks = snapshot.locks.filter(entry => !(entry.kind === "structure" && entry.targetId === documentId)
        && !(entry.kind === "item" && removed.has(entry.targetId)));
      durationHydratedDocument.current = null;
      setSnapshot(snapshotWithLocks(next, retainedLocks));
      await session.releaseMany(Object.values(locksRef.current).filter(entry => entry.kind === "structure" || removed.has(entry.targetId)));
      setDrafts({}); setPageColors({}); setStructurePages(null); setRefreshResults(null); setReimportDiff(null); setEditingPageId(null);
      setPageIndex(current => Math.min(current, Math.max(0, next.document.pages.length - 1))); setSlotIndex(0);
      setStatus({ tone: "success", text: `Release Masterの作品構成をversion ${next.version}として取り込み直しました。既存作品の修正内容と背景設定は保持されています。` });
    } catch (error) {
      const apiError = error as GeneratorApiError;
      if (apiError.status !== undefined && apiError.status < 500) pendingSaves.delete(requestKey);
      setStatus(apiError.code === "VERSION_CONFLICT" || apiError.code === "LOCK_LOST"
        ? { tone: "error", text: "確認中に別の変更が保存されました。最新版を再読込して、差分を確認し直してください。" }
        : { tone: "error", text: apiError.message });
    } finally {
      setBusy(false);
    }
  }

  function applyRefresh(selected: { itemId: string; key: RefreshFieldKey; next: string }[]) {
    if (!selected.length) return;
    const grouped = new Map<string, { key: RefreshFieldKey; next: string }[]>();
    for (const value of selected) {
      const changes = grouped.get(value.itemId) || [];
      changes.push({ key: value.key, next: value.next });
      grouped.set(value.itemId, changes);
    }
    setDrafts(current => {
      const next = { ...current };
      for (const [itemId, changes] of grouped) {
        const base = current[itemId] || items.get(itemId)?.content;
        if (!base) continue;
        next[itemId] = applySourceRefresh(cloneContent(base), changes);
      }
      return next;
    });
    const pageNumbers = [...new Set((refreshResults || [])
      .filter(item => grouped.has(item.itemId))
      .map(item => item.pageNo))].sort((a, b) => a - b);
    setRefreshResults(null);
    setStatus({
      tone: "warn",
      text: `Release Masterの内容を${selected.length}件、下書きへ入れました。画像 ${pageNumbers.join("・")} を開き、「編集」してから「保存」でversionに確定してください。`,
    });
  }

  function restoreRecovery() {
    try {
      const recovered = readRecovery(actor, documentId).document;
      const currentItems = new Set(snapshot.document.items.map(item => item.id));
      const recoveredItems = new Map(recovered.items.map(item => [item.id, item.content]));
      const currentPageIds = new Set(snapshot.document.pages.map(current => current.id));
      const recoveredPages = new Map(recovered.pages.map(recoveredPage => [recoveredPage.id, recoveredPage]));
      const sameItems = currentItems.size === recoveredItems.size && [...currentItems].every(id => recoveredItems.has(id));
      const samePages = currentPageIds.size === recoveredPages.size && snapshot.document.pages.every(current => {
        const recoveredPage = recoveredPages.get(current.id);
        return recoveredPage?.kind === current.kind;
      });
      if (!sameItems || !samePages) throw new Error("共有DB側の作品または画像構成が変わっているため、安全に復旧できません。");
      setDrafts(Object.fromEntries([...currentItems].flatMap(id => recoveredItems.has(id) ? [[id, cloneContent(recoveredItems.get(id)!)] as const] : [])));
      setPageColors(Object.fromEntries(recovered.pages
        .filter(value => snapshot.document.pages.some(current => current.id === value.id) && value.bgColor)
        .map(value => [value.id, value.bgColor!] as const)));
      setStructurePages(snapshot.document.pages.map(current => ({
        ...current,
        itemIds: [...recoveredPages.get(current.id)!.itemIds],
      })));
      const themeChanged = !same(recovered.theme, snapshot.document.theme);
      setStatus({
        tone: "warn",
        text: themeChanged
          ? "このブラウザ内の復旧用コピーを読み込みました。共通設定にも未保存の変更が残っています。共通設定の画面で読み込んでください。"
          : "このブラウザ内の復旧用コピーを読み込みました。画像ごとに「編集」してから、共有DBへ保存してください。",
      });
    } catch (error) {
      setStatus({ tone: "error", text: `復旧できませんでした: ${(error as Error).message}` });
    }
  }

  function discardRecovery() {
    clearRecovery(actor, documentId);
    setRecoveryAvailable(false);
    setRecoveryStatus("復旧用コピーを破棄しました。");
  }

  const restoreVersions = history.filter(entry => entry.version < snapshot.version);
  const latestReimportVersion = history.find(entry => entry.operation === "reimport")?.version || 0;
  const savedPage = page ? snapshot.document.pages.find(value => value.id === page.id) || null : null;
  // 未保存の背景色は表示中のページ以外にもあり得る。書き出せない理由には全ページ分を挙げる。
  const dirtyPages = snapshot.document.pages
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => pageColors[value.id] !== undefined && pageColors[value.id] !== value.bgColor);
  const pageDirty = Boolean(savedPage && dirtyPages.some(({ value }) => value.id === savedPage.id));
  const structureDirty = Boolean(structurePages) && !same(
    structurePages!.map(value => ({ id: value.id, itemIds: value.itemIds })),
    snapshot.document.pages.map(value => ({ id: value.id, itemIds: value.itemIds })),
  );
  const unsavedLabels = [
    ...snapshot.document.items.filter(item => itemDirty(item.id)).map(item => `作品「${item.content.fields.title || "作品名未入力"}」`),
    ...dirtyPages.map(({ index }) => `画像 ${snapshot.document.series === "weekly" ? index : index + 2} の背景色`),
    ...(structureDirty ? ["並び順"] : []),
  ];
  const imageDirty = Boolean(page && pageHasUnsaved(page.id));
  const imageEditing = Boolean(page && editingPageId === page.id);
  const pageNumber = previewPage?.no ?? (snapshot.document.series === "weekly" ? currentIndex : currentIndex + 2);

  /** この画像が最後に保存されたのはいつか。文書の通し番号ではなく、画像ごとに見せる。 */
  const imageSaved = page
    ? history.find(entry => (entry.targetKind === "item" && page.itemIds.includes(entry.targetId || ""))
      || (entry.targetKind === "page" && entry.targetId === page.id)) || null
    : null;

  const foreignOnPage = page
    ? snapshot.locks.find(lock => !activeLocks[keyOf(lock.kind as LockKind, lock.targetId)]
      && ((lock.kind === "page" && lock.targetId === page.id) || (lock.kind === "item" && page.itemIds.includes(lock.targetId))))
    : undefined;

  function targetState(kind: LockKind, targetId: string, isDirty: boolean, onBegin: () => void, onSave: () => void): TargetState {
    const locked = Boolean(activeLocks[keyOf(kind, targetId)]);
    const foreign = locked ? undefined : snapshot.locks.find(value => value.kind === kind && value.targetId === targetId);
    return {
      kind,
      targetId,
      locked,
      lockedBy: foreign ? foreign.owner : null,
      transferable: Boolean(foreign && foreign.owner === actor),
      dirty: isDirty,
      disabled: busy,
      versions: kind === "structure" ? restoreVersions.filter(entry => entry.version >= latestReimportVersion) : restoreVersions,
      onBegin,
      onSave,
      onRelease: () => void session.release(kind, targetId),
      onRestore: version => void saveSingle(kind, targetId, undefined, version),
      onTransfer: () => void session.acquire(kind, targetId, "transfer"),
    };
  }

  const heldElsewhere = snapshot.locks.filter(lock => !activeLocks[keyOf(lock.kind as LockKind, lock.targetId)]);
  const panelTabs: SegmentOption<PanelKey>[] = [
    { value: "info", label: "情報修正", dot: activeItem && itemDirty(activeItem.id) ? "warn" : undefined },
    { value: "background", label: "背景設定", dot: pageDirty ? "warn" : undefined },
  ];
  const bodyDiagnostic = diagnostics && previewPage && diagnostics.pageId === previewPage.id ? diagnostics.body : [];

  function selectPage(index: number) {
    const nextPage = visiblePages[index];
    // 直していない画像のロックは持ち歩かない。未保存があるときだけ、戻れるように残す。
    if (editingPageId && nextPage && editingPageId !== nextPage.id && !pageHasUnsaved(editingPageId)) {
      void endImageEdit(editingPageId, true);
    }
    setPageIndex(index);
    setSlotIndex(0);
  }

  /** プレビューのクリック・ドラッグから、編集パネルの調整対象と選択範囲を決める。 */
  function selectFromPreview(value: PreviewSelection & { touch?: boolean }) {
    const item = pageItems[value.slotIndex];
    if (!item) return;
    setPanel("info");
    setSlotIndex(value.slotIndex);
    setSelectionState({
      itemId: item.id,
      slotIndex: value.slotIndex,
      key: value.key,
      start: value.start,
      end: value.end,
      source: value.touch ? "previewTouch" : "preview",
    });
  }

  // 文書全体の集計（未保存◯件）だけでは、どの画像かがサムネイルから分からない。
  const pageBadges = derivePageBadges({
    pages: previewPages.map(value => ({ id: value.id, itemIds: value.slots.map(slot => slot.id), bgColor: value.bgColor })),
    isItemDirty: itemDirty,
    dirtyPageIds: new Set(dirtyPages.map(entry => entry.value.id)),
    pageColors,
    foreignLocks: heldElsewhere,
  });

  const navigator = (orientation: "vertical" | "horizontal") => (
    <PageNavigator
      documentId={documentId}
      pages={previewPages}
      pageIndex={currentIndex}
      onSelect={selectPage}
      onReorder={() => setReorderOpen(true)}
      reorderDirty={structureDirty}
      orientation={orientation}
      states={pageBadges}
    />
  );

  return (
    <GeneratorRuntimeProvider documentId={documentId} theme={snapshot.document.theme} period={snapshot.document.period}>
      <div className="generator-workspace relative left-1/2 w-[calc(100vw-2rem)] max-w-[100rem] -translate-x-1/2 space-y-4">
        {/* 企画名・未保存件数・移動を1行に畳む。空けた縦はプレビューへ回す。 */}
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/generator" className="shrink-0 text-xs text-violet-300 hover:underline">← 企画一覧</Link>
            <h1 className="min-w-0 truncate text-base font-bold sm:text-lg">
              {seriesLabels[snapshot.document.series]} {periodLabel(snapshot.document)}
            </h1>
            {unsavedLabels.length > 0 ? <Chip tone="warn">未保存 {unsavedLabels.length}件</Chip> : <Chip tone="success">すべて保存済み</Chip>}
          </div>
          {/* shrink-0 にすると、狭い画面でボタンが画面外へはみ出して押せなくなる。 */}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/generator/${documentId}/settings`}
              className="inline-flex min-h-9 items-center rounded-xl border px-3 text-xs hover:bg-white/5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              共通設定
            </Link>
            <Link
              href={`/generator/${documentId}/history`}
              className="inline-flex min-h-9 items-center rounded-xl border px-3 text-xs hover:bg-white/5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              変更履歴
            </Link>
            <SecondaryButton disabled={busy} onClick={() => void reload()} className="min-h-9 px-3 text-xs">共有DBを再読込</SecondaryButton>
            {/* 共有DBの再読込とは別物。Release Master側で直した文字情報だけを下書きへ入れる。 */}
            <SecondaryButton disabled={busy} onClick={() => void refreshFromSource()} className="min-h-9 px-3 text-xs">Release Masterから再取得</SecondaryButton>
            {/* 作品数・採用区分を共同編集の新しいversionとして変える。未保存下書きがある時はopenReimportで止める。 */}
            <SecondaryButton disabled={busy} onClick={() => void openReimport()} className="min-h-9 px-3 text-xs">Release Masterから取り込み直す</SecondaryButton>
            {/* 全ページのPNGは文書単位の操作なので、ページごとの出力ボタンとは分けてここに置く。 */}
            <BulkExportButton document={previewDocument} pages={previewPages} canExport={!dirty} onStatus={setStatus} />
          </div>
        </header>

        {previewPage && (
          <CoverColorProbe
            documentId={documentId}
            pageId={previewPage.id}
            source={colorSource}
            known={Boolean(colorCandidates[previewPage.id])}
            onColors={rememberColors}
          />
        )}

        {reimportDiff && (
          <ReimportDialog
            document={snapshot.document}
            diff={reimportDiff}
            disabled={busy}
            onApply={value => void applyReimport(value)}
            onClose={() => void closeReimport()}
          />
        )}

        {/* 直前の結果・ほかの編集者・復旧保存を1本の帯へ。情報は減らさず、段だけ減らす。 */}
        <StatusBanner
          tone={status.tone}
          dense
          actions={
            <>
              {heldElsewhere.map(lock => (
                <span key={`${lock.kind}:${lock.targetId}`} className="flex items-center gap-1">
                  <Chip tone="warn">{targetLabels[lock.kind as LockKind]}</Chip>
                  <span style={{ color: "var(--text-secondary)" }}>{lock.owner} が編集中</span>
                  {lock.owner === actor && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void session.acquire(lock.kind as LockKind, lock.targetId, "transfer")}
                      className="rounded border px-2 py-0.5 disabled:opacity-40"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      この端末へ引き継ぐ
                    </button>
                  )}
                </span>
              ))}
              <span style={{ color: "var(--text-secondary)" }}>{recoveryStatus}</span>
              {recoveryAvailable && (
                <span className="flex gap-2">
                  <button type="button" onClick={restoreRecovery} className="rounded border px-2 py-0.5" style={{ borderColor: "var(--border-subtle)" }}>復旧用コピーを開く</button>
                  <button type="button" onClick={discardRecovery} className="rounded border px-2 py-0.5" style={{ borderColor: "var(--border-subtle)" }}>破棄</button>
                </span>
              )}
            </>
          }
        >
          {status.text}
        </StatusBanner>

        {!wide && <div className="xl:hidden">{navigator("horizontal")}</div>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:h-[calc(100vh-13rem)] xl:grid-cols-[8.5rem_minmax(0,1fr)_26rem] xl:items-stretch">
          <aside className="hidden xl:block xl:h-full xl:min-h-0">
            {wide && navigator("vertical")}
          </aside>

          {/* 行送りを触っている間もプレビューが見えているように、画面上部へ留める。 */}
          <Panel padding="tight" className="sticky top-16 z-20 xl:static xl:h-full xl:min-h-0 xl:overflow-y-auto">
            {previewPage ? (
              <GeneratorPreview
                document={previewDocument}
                page={previewPage}
                pageNumber={previewPage.no}
                onDiagnostics={handleDiagnostics}
                onSelect={selectFromPreview}
                selection={selection.key === "text" && selection.itemId === activeItem?.id
                  ? { slotIndex: selection.slotIndex, key: selection.key, start: selection.start, end: selection.end }
                  : null}
                canExport={!dirty}
                blockedReasons={unsavedLabels}
              />
            ) : (
              <p className="text-sm text-amber-300">表示できる画像がありません。</p>
            )}
          </Panel>

          <Panel className="xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
            <div className="shrink-0 space-y-2">
              {/* 画像ごとの状態と操作。この1行で「いま何ができるか」と「保存」を完結させる。 */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border px-2 py-1.5" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="text-xs font-semibold">画像 {pageNumber}</span>
                {imageEditing
                  ? <Chip tone="success">編集中 · 自動延長</Chip>
                  : foreignOnPage
                    ? <Chip tone="warn">{foreignOnPage.owner === actor ? "自分の別端末が編集中" : `${foreignOnPage.owner} が編集中`}</Chip>
                    : null}
                {imageDirty ? <Chip tone="warn">未保存</Chip> : <Chip tone="info">共有DBと一致</Chip>}
                <span className="flex-1" />
                {imageEditing ? (
                  <>
                    <PrimaryButton disabled={busy || !imageDirty} onClick={() => void saveImage()} className="min-h-9 px-3 text-xs">保存</PrimaryButton>
                    <SecondaryButton disabled={busy} onClick={() => void endImageEdit(page!.id)} className="min-h-9 px-3 text-xs">編集を終了</SecondaryButton>
                  </>
                ) : (
                  <>
                    <PrimaryButton
                      disabled={busy || !page || Boolean(foreignOnPage && foreignOnPage.owner !== actor)}
                      onClick={() => void beginImageEdit()}
                      className="min-h-9 px-3 text-xs"
                    >
                      この画像を編集
                    </PrimaryButton>
                    {foreignOnPage && foreignOnPage.owner === actor && (
                      <SecondaryButton
                        disabled={busy}
                        onClick={() => void session.acquire(foreignOnPage.kind as LockKind, foreignOnPage.targetId, "transfer")}
                        className="min-h-9 px-3 text-xs"
                      >
                        この端末へ引き継ぐ
                      </SecondaryButton>
                    )}
                  </>
                )}
              </div>
              <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {imageSaved
                  ? `最終保存 version ${imageSaved.version} · ${imageSaved.actor} · ${savedAtFormat.format(new Date(imageSaved.createdAt))}`
                  : "この画像は取り込み後まだ保存されていません。"}
              </p>
              <SegmentedControl label="編集パネル" options={panelTabs} value={panel} onChange={next => setPanel(next)} />
              {panel === "info" && page?.kind === "others" && pageItems.length > 1 ? (
                <label className="block text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Other Releasesの作品
                  <SelectInput
                    value={String(Math.min(slotIndex, pageItems.length - 1))}
                    onChange={event => setSlotIndex(Number(event.target.value))}
                    className="mt-1"
                  >
                    {pageItems.map((item, index) => (
                      <option key={item.id} value={index}>{index + 1}. {item.content.fields.title || "（作品名未入力）"} / {item.content.fields.artist}</option>
                    ))}
                  </SelectInput>
                </label>
              ) : panel === "info" && pageItems.length > 1 ? (
                <SegmentedControl
                  label="掲載の位置"
                  size="small"
                  value={String(Math.min(slotIndex, pageItems.length - 1))}
                  onChange={next => setSlotIndex(Number(next))}
                  options={pageItems.map((item, index) => ({
                    value: String(index),
                    label: index === 0 ? "上段" : "下段",
                    dot: itemDirty(item.id) ? "warn" : undefined,
                  }))}
                />
              ) : null}
              {imageEditing && activeItem && panel === "info" && (
                <RestoreControl state={itemTargetStateFor(activeItem.id)} compact />
              )}
              {imageEditing && savedPage && panel === "background" && (
                <RestoreControl state={pageTargetStateFor(savedPage.id)} compact />
              )}
            </div>

            <div className="mt-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
              {panel === "background" ? (
                <div className="xl:overflow-y-auto xl:pr-1">
                  {savedPage ? (
                    <PageInspector
                      state={pageTargetStateFor(savedPage.id)}
                      pageNumber={pageNumber}
                      color={pageColors[savedPage.id] ?? savedPage.bgColor ?? FALLBACK_PAGE_COLOR}
                      defined={Boolean(pageColors[savedPage.id] ?? savedPage.bgColor)}
                      candidates={colorCandidates[savedPage.id] || []}
                      onColor={value => setPageColors(current => ({ ...current, [savedPage.id]: value }))}
                    />
                  ) : (
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>背景を編集できる画像がありません。</p>
                  )}
                </div>
              ) : activeItem && page && (page.kind === "adopted" || page.kind === "listed" || page.kind === "feature" || page.kind === "others") ? (
                <ItemInspector
                  key={`${activeItem.id}:${snapshot.itemVersions[activeItem.id]}`}
                  item={activeItem}
                  draft={drafts[activeItem.id]}
                  pageKind={page.kind}
                  diagnostic={bodyDiagnostic.find(value => value.slotId === activeItem.id) || null}
                  state={itemTargetStateFor(activeItem.id)}
                  onDraft={content => setDrafts(current => ({ ...current, [activeItem.id]: content }))}
                  onImage={file => session.uploadImage("item", activeItem.id, file)}
                  selection={selection}
                  onSelection={next => setSelectionState({ ...next, itemId: activeItem.id, slotIndex: Math.min(slotIndex, Math.max(0, pageItems.length - 1)) })}
                  allowTracking={!phone}
                />
              ) : (
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>この画像に作品がありません。</p>
              )}
            </div>
          </Panel>
        </div>

        {refreshResults && (
          <SourceRefreshDialog
            results={refreshResults}
            disabled={busy}
            onApply={applyRefresh}
            onClose={() => setRefreshResults(null)}
          />
        )}

        {reorderOpen && (
          <StructureDialog
            state={targetState(
              "structure",
              documentId,
              structureDirty,
              () => void (async () => {
                const lock = await session.acquire("structure", documentId);
                if (lock) setStructurePages(snapshot.document.pages.map(value => ({ ...value, itemIds: [...value.itemIds] })));
              })(),
              () => void saveSingle("structure", documentId, {
                pages: (structurePages || snapshot.document.pages).map(value => ({ id: value.id, itemIds: value.itemIds })),
              }),
            )}
            pages={visiblePages}
            items={items}
            onPages={setStructurePages}
            onClose={() => setReorderOpen(false)}
          />
        )}
      </div>
    </GeneratorRuntimeProvider>
  );

  /** 作品・背景の状態は画像の操作列がまとめて出すので、ここでは復元と入力欄の可否にだけ使う。 */
  function itemTargetStateFor(itemId: string): TargetState {
    return targetState("item", itemId, itemDirty(itemId), () => void beginImageEdit(), () => void saveImage());
  }

  function pageTargetStateFor(pageId: string): TargetState {
    return targetState("page", pageId, pageDirty, () => void beginImageEdit(), () => void saveImage());
  }
}
