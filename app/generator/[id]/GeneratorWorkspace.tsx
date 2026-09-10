"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canvasPreviewPage, type CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorHistoryEntry, GeneratorSnapshot } from "@/lib/generator/client-types";
import { parseDocument, type GeneratorDocument, type ItemContent } from "@/lib/generator/model";
import type { ReimportDiff } from "@/lib/generator/reimport";
import type { ReleaseMasterAlbum } from "@/lib/types";
import BulkExportButton from "../BulkExportButton";
import GeneratorPreview, { type PreviewDiagnostics, type PreviewSelection } from "../GeneratorPreview";
import PageNavigator from "../PageNavigator";
import { generatorJson, snapshotWithLocks, type GeneratorApiError } from "../generator-client";
import { GeneratorRuntimeProvider } from "../runtime";
import { Chip, Panel, SecondaryButton, SegmentedControl, SelectInput, StatusBanner, useMediaQuery, type SegmentOption, type Tone } from "../ui";
import { PageInspector, RestoreControl, StructureDialog, TargetStatus, ThemeInspector, type TargetState } from "./Inspectors";
import ItemInspector from "./ItemInspector";
import ReimportDialog from "./ReimportDialog";
import SourceRefreshDialog from "./SourceRefreshDialog";
import { applySourceRefresh, collectSourceRefresh, type RefreshFieldKey, type SourceRefreshItem } from "./source-refresh";
import {
  cloneContent,
  derivePageBadges,
  keyOf,
  lockPayload,
  lockToken,
  same,
  targetLabels,
  type ActiveLock,
  type FieldSelection,
  type LockKind,
  type LockResponse,
} from "./workspace-types";

/** 編集パネルは1段。「画像編集」の下に「情報修正／背景設定」を重ねない。 */
type PanelKey = "info" | "background" | "theme";
type Status = { tone: Tone; text: string };
type PendingSave = { requestId: string; signature: string };

const seriesLabels: Record<GeneratorDocument["series"], string> = {
  monthly: "Monthly Review",
  japan: "Monthly Japan Review",
  weekly: "Weekly Review",
};

const FALLBACK_PAGE_COLOR = "#475569";

function matchesLock(current: ActiveLock | undefined, expected: ActiveLock): boolean {
  return Boolean(current
    && current.clientId === expected.clientId
    && current.token === expected.token
    && current.generation === expected.generation);
}

function periodLabel(document: GeneratorDocument): string {
  if (document.series !== "weekly") return document.period.start.slice(0, 7);
  const source = new Date(`${document.period.start}T00:00:00.000Z`), thursday = new Date(source);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear(), yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year} WEEK ${document.period.weekNumber ?? week} · ${document.period.start}`;
}

export default function GeneratorWorkspace({ initialSnapshot, actor }: { initialSnapshot: GeneratorSnapshot; actor: string }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot), [pageIndex, setPageIndex] = useState(0);
  const [panel, setPanel] = useState<PanelKey>("info");
  const [slotIndex, setSlotIndex] = useState(0), [reorderOpen, setReorderOpen] = useState(false);
  const [activeLocks, setActiveLocks] = useState<Record<string, ActiveLock>>({}), [drafts, setDrafts] = useState<Record<string, ItemContent>>({});
  const [pageColors, setPageColors] = useState<Record<string, string>>({}), [themeDraft, setThemeDraft] = useState(snapshot.document.theme);
  const [structurePages, setStructurePages] = useState<GeneratorDocument["pages"] | null>(null);
  const [refreshResults, setRefreshResults] = useState<SourceRefreshItem[] | null>(null);
  const [reimportDiff, setReimportDiff] = useState<ReimportDiff | null>(null);
  const [history, setHistory] = useState<GeneratorHistoryEntry[]>([]), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ tone: "info", text: "プレビューまたは編集欄から直接調整できます。保存は対象ごとに新しいversionを作成します。" });
  const [diagnostics, setDiagnostics] = useState<PreviewDiagnostics | null>(null);
  const [selectionState, setSelectionState] = useState<FieldSelection | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState("このブラウザ内の復旧保存を準備しています…");
  const [clientId] = useState(() => crypto.randomUUID()), locksRef = useRef(activeLocks);
  const durationHydratedDocument = useRef<string | null>(null);
  // 応答不明の保存だけを同じrequestIdで再送するための、描画に関与しないインメモリキャッシュ。
  const [pendingSaves] = useState(() => new Map<string, PendingSave>());

  const wide = useMediaQuery("(min-width: 1280px)");
  // iPhoneでは字間の調整を出さない（範囲選択がページのスクロールと両立しないため）。
  // 保存済みの tracking / kerns はそのまま描画・保存され続ける。
  const phone = useMediaQuery("(max-width: 639px), (pointer: coarse) and (max-height: 500px)");
  const documentId = snapshot.document.id;
  const items = useMemo(() => new Map(snapshot.document.items.map(item => [item.id, item])), [snapshot.document.items]);
  const previewDocument = useMemo<GeneratorDocument>(() => ({
    ...snapshot.document,
    pages: (structurePages || snapshot.document.pages).map(value => ({ ...value, bgColor: pageColors[value.id] ?? value.bgColor })),
    items: snapshot.document.items.map(item => ({ ...item, content: drafts[item.id] || item.content })),
    theme: themeDraft,
  }), [drafts, pageColors, snapshot.document, structurePages, themeDraft]);
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
  const recoveryKey = `ryuryu_generator_recovery:v1:${actor}:${documentId}`;

  useEffect(() => { locksRef.current = activeLocks; }, [activeLocks]);

  // 既存versionの作成後に Release Master の Time が補完された場合も、空欄だけを最新値で下書きへ戻す。
  // 共有DBは自動更新せず、利用者が各作品の「保存」でversionとして確定する。
  useEffect(() => {
    if (durationHydratedDocument.current === documentId) return;
    durationHydratedDocument.current = documentId;
    let cancelled = false;
    void fetch("/api/release-master", { cache: "no-store" })
      .then(generatorJson<ReleaseMasterAlbum[]>)
      .then(albums => {
        if (cancelled) return;
        const byUid = new Map(albums.filter(album => album.uid).map(album => [album.uid, album]));
        const byNo = new Map(albums.map(album => [album.no, album]));
        const byName = new Map(albums.map(album => [`${album.title.trim().toLowerCase()}::${album.artist.trim().toLowerCase()}`, album]));
        const durations = new Map<string, string>();
        for (const item of snapshot.document.items) {
          if (item.content.fields.duration.trim()) continue;
          const album = (item.source.uid ? byUid.get(item.source.uid) : undefined)
            || (item.source.no ? byNo.get(item.source.no) : undefined)
            || byName.get(`${item.source.fields.title.trim().toLowerCase()}::${item.source.fields.artist.trim().toLowerCase()}`);
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
        if (durations.size) setStatus({ tone: "success", text: `Release Masterから空欄のTimeを${durations.size}件読み込みました。各作品の「保存」でversionに確定できます。` });
      })
      .catch(() => {
        if (!cancelled) setStatus({ tone: "warn", text: "Release MasterのTimeを再取得できませんでした。ほかの編集機能は利用できます。" });
      });
    return () => { cancelled = true; };
  }, [documentId, snapshot.document.items]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setRecoveryAvailable(Boolean(window.localStorage.getItem(recoveryKey)));
        setRecoveryStatus("このブラウザにも復旧用コピーを保存します（共有保存とは別）。");
      } catch {
        setRecoveryStatus("このブラウザでは復旧用コピーを保存できません。共有DBへの保存を利用してください。");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [recoveryKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (!dirty) return;
        window.localStorage.setItem(recoveryKey, JSON.stringify({
          schemaVersion: 1,
          actor,
          documentId,
          baseVersion: snapshot.version,
          savedAt: new Date().toISOString(),
          document: previewDocument,
        }));
        setRecoveryAvailable(true);
        setRecoveryStatus(`復旧用コピー保存済み · ${new Date().toLocaleTimeString("ja-JP")}（共有保存なし）`);
      } catch {
        setRecoveryStatus("復旧用コピーを保存できませんでした。共有DBには未保存です。");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [actor, dirty, documentId, previewDocument, recoveryKey, snapshot.version]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/generator/documents/${documentId}/revisions`, { cache: "no-store" })
      .then(generatorJson<GeneratorHistoryEntry[]>)
      .then(value => { if (!cancelled) setHistory(value); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [documentId, snapshot.version]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const lock of Object.values(locksRef.current)) {
        void fetch(`/api/generator/documents/${documentId}/locks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "heartbeat", ...lockPayload(lock) }),
        })
          .then(generatorJson<LockResponse>)
          .then(result => setActiveLocks(current => {
            const key = keyOf(lock.kind, lock.targetId);
            if (!matchesLock(current[key], lock)) return current;
            return { ...current, [key]: { ...current[key], expiresAt: result.expiresAt } };
          }))
          .catch(() => {
            setActiveLocks(current => {
              const key = keyOf(lock.kind, lock.targetId);
              if (!matchesLock(current[key], lock)) return current;
              const next = { ...current };
              delete next[key];
              return next;
            });
            setStatus({ tone: "error", text: "編集ロックを失いました。最新版を再読込してから、もう一度編集を開始してください。" });
          });
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [documentId]);

  useEffect(() => () => {
    for (const lock of Object.values(locksRef.current)) {
      void fetch(`/api/generator/documents/${documentId}/locks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ action: "release", ...lockPayload(lock) }),
      });
    }
  }, [documentId]);

  const handleDiagnostics = useCallback((value: PreviewDiagnostics) => setDiagnostics(value), []);

  async function acquire(kind: LockKind, targetId: string, action: "acquire" | "transfer" = "acquire"): Promise<ActiveLock | null> {
    const existing = activeLocks[keyOf(kind, targetId)];
    if (existing) return existing;
    // 作品・背景の直接編集では、次の対象を開く前に以前の自動取得ロックを解放する。
    // これによりページを見て回っても複数作品を占有し続けない。
    if (kind === "item" || kind === "page") {
      const stale = Object.values(activeLocks).filter(lock =>
        (lock.kind === "item" || lock.kind === "page") && !(lock.kind === kind && lock.targetId === targetId));
      if (stale.length) {
        setActiveLocks(current => {
          const next = { ...current };
          for (const lock of stale) {
            const key = keyOf(lock.kind, lock.targetId);
            if (matchesLock(next[key], lock)) delete next[key];
          }
          return next;
        });
        setSnapshot(current => ({
          ...current,
          locks: current.locks.filter(value => !stale.some(lock => lock.kind === value.kind && lock.targetId === value.targetId)),
        }));
        await Promise.allSettled(stale.map(lock => fetch(`/api/generator/documents/${documentId}/locks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "release", ...lockPayload(lock) }),
        })));
      }
    }
    setBusy(true);
    setStatus({ tone: "info", text: "編集ロックを取得しています…" });
    const seed = { kind, targetId, clientId, token: lockToken() };
    try {
      const result = await generatorJson<LockResponse>(await fetch(`/api/generator/documents/${documentId}/locks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...seed }),
      }));
      const lock = { ...seed, generation: result.generation, expiresAt: result.expiresAt };
      setActiveLocks(current => ({ ...current, [keyOf(kind, targetId)]: lock }));
      setSnapshot(current => ({
        ...current,
        locks: [
          ...current.locks.filter(value => !(value.kind === kind && value.targetId === targetId)),
          { kind, targetId, owner: result.owner, expiresAt: result.expiresAt },
        ],
      }));
      setStatus(action === "transfer"
        ? { tone: "success", text: "編集権をこの端末へ引き継ぎました。以前の端末からは保存できません。" }
        : { tone: "success", text: `${targetLabels[kind]}を編集できます。ロックは操作中、自動で延長されます。` });
      return lock;
    } catch (error) {
      setStatus({ tone: "error", text: (error as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function release(kind: LockKind, targetId: string) {
    const lock = activeLocks[keyOf(kind, targetId)];
    if (!lock) return;
    try {
      await generatorJson(await fetch(`/api/generator/documents/${documentId}/locks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", ...lockPayload(lock) }),
      }));
    } catch { /* An expired lock is already unusable. */ }
    setActiveLocks(current => {
      const next = { ...current };
      delete next[keyOf(kind, targetId)];
      return next;
    });
    setSnapshot(current => ({ ...current, locks: current.locks.filter(value => !(value.kind === kind && value.targetId === targetId)) }));
    setStatus({ tone: "info", text: `${targetLabels[kind]}の編集を終了しました。他の人が編集できます。` });
  }

  async function save(kind: LockKind, targetId: string, content?: unknown, restoreVersion?: number) {
    const lock = activeLocks[keyOf(kind, targetId)];
    if (!lock) {
      setStatus({ tone: "warn", text: "先に編集ロックを取得してください。" });
      return;
    }
    const expectedVersion = kind === "item"
      ? snapshot.itemVersions[targetId]
      : kind === "page"
        ? snapshot.pageVersions[targetId]
        : kind === "structure" ? snapshot.structureVersion : snapshot.themeVersion;
    setBusy(true);
    setStatus({ tone: "info", text: restoreVersion ? `version ${restoreVersion} の内容を復元しています…` : "共有DBへ保存しています…" });
    const requestKey = keyOf(kind, targetId);
    const change = {
      ...lockPayload(lock),
      expectedVersion,
      ...(restoreVersion ? { restoreVersion } : { content }),
    };
    const signature = JSON.stringify(change);
    const previousRequest = pendingSaves.get(requestKey);
    const requestId = previousRequest?.signature === signature ? previousRequest.requestId : crypto.randomUUID();
    pendingSaves.set(requestKey, { requestId, signature });
    try {
      const next = await generatorJson<GeneratorSnapshot>(await fetch(`/api/generator/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          ...change,
        }),
      }));
      if (pendingSaves.get(requestKey)?.requestId === requestId) pendingSaves.delete(requestKey);
      setSnapshot(current => snapshotWithLocks(next, current.locks));
      if (kind === "item") {
        const saved = next.document.items.find(item => item.id === targetId);
        if (saved) setDrafts(current => ({ ...current, [targetId]: cloneContent(saved.content) }));
      } else if (kind === "page") {
        const saved = next.document.pages.find(value => value.id === targetId);
        if (saved) setPageColors(current => ({ ...current, [targetId]: saved.bgColor || FALLBACK_PAGE_COLOR }));
      } else if (kind === "structure") {
        setStructurePages(next.document.pages.map(value => ({ ...value, itemIds: [...value.itemIds] })));
      } else {
        setThemeDraft(next.document.theme);
      }
      setStatus({
        tone: "success",
        text: restoreVersion
          ? `version ${restoreVersion} の${targetLabels[kind]}を、新しいversion ${next.version} として復元しました。`
          : `${targetLabels[kind]}をversion ${next.version} として保存しました。`,
      });
    } catch (error) {
      const value = error as GeneratorApiError;
      // 通信失敗・5xxはDBで確定済みか判別できない。同じ内容の再試行では同じrequestIdを使う。
      if (value.status !== undefined && value.status < 500 && pendingSaves.get(requestKey)?.requestId === requestId) {
        pendingSaves.delete(requestKey);
      }
      setStatus(value.code === "VERSION_CONFLICT" || value.code === "LOCK_LOST"
        ? { tone: "error", text: "他の変更が先に保存されました。最新版を再読込してから、もう一度編集してください。" }
        : { tone: "error", text: value.message });
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    try {
      const next = await generatorJson<GeneratorSnapshot>(await fetch(`/api/generator/documents/${documentId}`, { cache: "no-store" }));
      durationHydratedDocument.current = null;
      setSnapshot(next);
      setActiveLocks({});
      setDrafts({});
      setPageColors({});
      setStructurePages(null);
      setThemeDraft(next.document.theme);
      setRefreshResults(null);
      setReimportDiff(null);
      pendingSaves.clear();
      setStatus({ tone: "success", text: "最新版を読み込みました。編集中だった内容は破棄されています。" });
    } catch (error) {
      setStatus({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /**
   * 取り込み後にRelease Master側で直された文字情報を読み直す。
   * 共有DBは触らず、選ばれた項目だけをローカル下書きへ入れる（確定は作品ごとの「保存」）。
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
    const lock = await acquire("structure", documentId);
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
      await release("structure", documentId);
    } finally {
      setBusy(false);
    }
  }

  async function closeReimport() {
    setReimportDiff(null);
    await release("structure", documentId);
  }

  async function applyReimport(value: { addKeys: string[]; removeItemIds: string[]; resort: boolean }) {
    const lock = activeLocks[keyOf("structure", documentId)];
    if (!lock) { setStatus({ tone: "warn", text: "取り込み直しの編集ロックを取得し直してください。" }); return; }
    if (dirty) { setStatus({ tone: "warn", text: "未保存の下書きがあるため、取り込み直しを実行できません。" }); return; }
    // 自分が削除対象の作品を開いていた場合、その作品ロックだけを先に返す。
    for (const itemId of value.removeItemIds) if (activeLocks[keyOf("item", itemId)]) await release("item", itemId);
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
      setActiveLocks(current => Object.fromEntries(Object.entries(current).filter(([, entry]) => entry.kind !== "structure" && !removed.has(entry.targetId))));
      setDrafts({}); setPageColors({}); setStructurePages(null); setThemeDraft(next.document.theme); setRefreshResults(null); setReimportDiff(null);
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
      text: `Release Masterの内容を${selected.length}件、下書きへ入れました。画像 ${pageNumbers.join("・")} の作品を開き、「保存」でversionに確定してください。`,
    });
  }

  function restoreRecovery() {
    try {
      const raw = window.localStorage.getItem(recoveryKey);
      if (!raw) throw new Error("復旧用コピーが見つかりません。");
      const value = JSON.parse(raw) as {
        schemaVersion?: unknown;
        actor?: unknown;
        documentId?: unknown;
        baseVersion?: unknown;
        savedAt?: unknown;
        document?: unknown;
      };
      if (value.schemaVersion !== 1 || value.actor !== actor || value.documentId !== documentId) throw new Error("別の利用者または企画の復旧データです。");
      if (typeof value.baseVersion !== "number" || !Number.isInteger(value.baseVersion) || value.baseVersion < 1
        || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) {
        throw new Error("復旧データの版情報が不正、または未対応です。");
      }
      const recovered = parseDocument(value.document);
      if (recovered.id !== documentId) throw new Error("復旧データ内の企画IDが一致しません。");
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
      setThemeDraft(recovered.theme);
      setStatus({ tone: "warn", text: "このブラウザ内の復旧用コピーを読み込みました。対象の編集を開始し、共有DBへ保存してください。" });
    } catch (error) {
      setStatus({ tone: "error", text: `復旧できませんでした: ${(error as Error).message}` });
    }
  }

  function discardRecovery() {
    try {
      window.localStorage.removeItem(recoveryKey);
    } catch { /* No recoverable local copy remains available to this page. */ }
    setRecoveryAvailable(false);
    setRecoveryStatus("復旧用コピーを破棄しました。");
  }

  async function uploadImage(kind: "item" | "theme", targetId: string, file: File): Promise<string | null> {
    const lock = activeLocks[keyOf(kind, targetId)];
    if (!lock) {
      setStatus({ tone: "warn", text: "画像を選ぶ前に編集ロックを取得してください。" });
      return null;
    }
    const form = new FormData(), assetId = crypto.randomUUID();
    form.set("file", file);
    form.set("assetId", assetId);
    form.set("kind", kind);
    form.set("targetId", targetId);
    form.set("clientId", lock.clientId);
    form.set("token", lock.token);
    form.set("generation", String(lock.generation));
    setBusy(true);
    setStatus({ tone: "info", text: "画像を検証して共有Storageへ保存しています…" });
    try {
      const result = await generatorJson<{ id: string }>(await fetch(`/api/generator/documents/${documentId}/assets`, { method: "POST", body: form }));
      setStatus({ tone: "success", text: "画像を保存しました。この対象の「保存」で、版に確定してください。" });
      return result.id;
    } catch (error) {
      setStatus({ tone: "error", text: (error as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  const restoreVersions = history.filter(entry => entry.version < snapshot.version);
  const latestReimportVersion = history.find(entry => entry.operation === "reimport")?.version || 0;
  const savedPage = page ? snapshot.document.pages.find(value => value.id === page.id) || null : null;
  const itemDirty = (id: string) => Boolean(drafts[id]) && !same(drafts[id], items.get(id)?.content);
  // 未保存の背景色は表示中のページ以外にもあり得る。書き出せない理由には全ページ分を挙げる。
  const dirtyPages = snapshot.document.pages
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => pageColors[value.id] !== undefined && pageColors[value.id] !== value.bgColor);
  const pageDirty = Boolean(savedPage && dirtyPages.some(({ value }) => value.id === savedPage.id));
  const structureDirty = Boolean(structurePages) && !same(
    structurePages!.map(value => ({ id: value.id, itemIds: value.itemIds })),
    snapshot.document.pages.map(value => ({ id: value.id, itemIds: value.itemIds })),
  );
  const themeDirty = !same(themeDraft, snapshot.document.theme);
  const unsavedLabels = [
    ...snapshot.document.items.filter(item => itemDirty(item.id)).map(item => `作品「${item.content.fields.title || "作品名未入力"}」`),
    ...dirtyPages.map(({ index }) => `画像 ${snapshot.document.series === "weekly" ? index : index + 2} の背景色`),
    ...(structureDirty ? ["並び順"] : []),
    ...(themeDirty ? ["共通設定"] : []),
  ];

  function targetState(kind: LockKind, targetId: string, isDirty: boolean, onBegin: () => void, onSave: () => void, direct = false): TargetState {
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
      direct,
      versions: kind === "structure" ? restoreVersions.filter(entry => entry.version >= latestReimportVersion) : restoreVersions,
      onBegin,
      onSave,
      onRelease: () => void release(kind, targetId),
      onRestore: version => void save(kind, targetId, undefined, version),
      onTransfer: () => void acquire(kind, targetId, "transfer"),
    };
  }

  const heldElsewhere = snapshot.locks.filter(lock => !activeLocks[keyOf(lock.kind as LockKind, lock.targetId)]);
  const panelTabs: SegmentOption<PanelKey>[] = [
    { value: "info", label: "情報修正", dot: activeItem && itemDirty(activeItem.id) ? "warn" : activeItem && activeLocks[keyOf("item", activeItem.id)] ? "success" : undefined },
    { value: "background", label: "背景設定", dot: pageDirty ? "warn" : savedPage && activeLocks[keyOf("page", savedPage.id)] ? "success" : undefined },
    { value: "theme", label: "共通設定", dot: themeDirty ? "warn" : activeLocks[keyOf("theme", documentId)] ? "success" : undefined },
  ];
  const bodyDiagnostic = diagnostics && previewPage && diagnostics.pageId === previewPage.id ? diagnostics.body : [];

  function selectPage(index: number) {
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

  // 対象ごとの操作列はタブと同じ行へ出すため、JSXの外で組み立てる。
  // `direct` の自動ロック取得は、表示されている対象の分だけ走る（従来と同じ）。
  const itemTargetState = activeItem
    ? targetState(
      "item",
      activeItem.id,
      itemDirty(activeItem.id),
      async () => {
        const lock = await acquire("item", activeItem.id);
        if (lock) setDrafts(current => current[activeItem.id]
          ? current
          : { ...current, [activeItem.id]: cloneContent(activeItem.content) });
      },
      () => void save("item", activeItem.id, drafts[activeItem.id] || activeItem.content),
      true,
    )
    : null;
  const pageTargetState = savedPage
    ? targetState(
      "page",
      savedPage.id,
      pageDirty,
      () => void acquire("page", savedPage.id),
      () => void save("page", savedPage.id, { bgColor: pageColors[savedPage.id] ?? savedPage.bgColor ?? FALLBACK_PAGE_COLOR }),
      true,
    )
    : null;
  const themeTargetState = targetState(
    "theme",
    documentId,
    themeDirty,
    async () => {
      const lock = await acquire("theme", documentId);
      if (lock) setThemeDraft(snapshot.document.theme);
    },
    () => void save("theme", documentId, themeDraft),
  );
  const activeTarget = panel === "theme" ? themeTargetState : panel === "background" ? pageTargetState : itemTargetState;
  const activeTargetLabel = panel === "theme" ? "共通設定" : panel === "background" ? "背景" : "作品";

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
    <GeneratorRuntimeProvider documentId={documentId} theme={themeDraft} period={snapshot.document.period}>
      <div className="generator-workspace relative left-1/2 w-[calc(100vw-2rem)] max-w-[100rem] -translate-x-1/2 space-y-4">
        {/* 企画名・版・未保存件数・移動を1行に畳む。空けた縦はプレビューへ回す。 */}
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/generator" className="shrink-0 text-xs text-violet-300 hover:underline">← 企画一覧</Link>
            <h1 className="min-w-0 truncate text-base font-bold sm:text-lg">
              {seriesLabels[snapshot.document.series]} {periodLabel(snapshot.document)}
            </h1>
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              version {snapshot.version} · 更新者 {snapshot.updatedBy}
            </span>
            {unsavedLabels.length > 0 ? <Chip tone="warn">未保存 {unsavedLabels.length}件</Chip> : <Chip tone="success">すべて保存済み</Chip>}
          </div>
          {/* shrink-0 にすると、狭い画面でボタンが画面外へはみ出して押せなくなる。 */}
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/generator/${documentId}/history`}
              className="inline-flex min-h-9 items-center rounded-xl border px-3 text-xs hover:bg-white/5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              変更履歴
            </Link>
            <SecondaryButton disabled={busy} onClick={() => void reload()} className="min-h-9 px-3 text-xs">最新版を再読込</SecondaryButton>
            {/* 共有DBの再読込とは別物。Release Master側で直した文字情報だけを下書きへ入れる。 */}
            <SecondaryButton disabled={busy} onClick={() => void refreshFromSource()} className="min-h-9 px-3 text-xs">Release Masterから再取得</SecondaryButton>
            {/* 作品数・採用区分を共同編集の新しいversionとして変える。未保存下書きがある時はopenReimportで止める。 */}
            <SecondaryButton disabled={busy} onClick={() => void openReimport()} className="min-h-9 px-3 text-xs">Release Masterから取り込み直す</SecondaryButton>
            {/* 全ページのPNGは文書単位の操作なので、ページごとの出力ボタンとは分けてここに置く。 */}
            <BulkExportButton document={previewDocument} pages={previewPages} canExport={!dirty} onStatus={setStatus} />
          </div>
        </header>

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
                      onClick={() => void acquire(lock.kind as LockKind, lock.targetId, "transfer")}
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
              {/* 1段目＝編集する対象、2段目＝その対象の状態と保存・復元。主操作までの段を4から2へ。 */}
              <SegmentedControl label="編集パネル" options={panelTabs} value={panel} onChange={next => setPanel(next)} />
              {activeTarget && (
                <TargetStatus
                  state={activeTarget}
                  label={activeTargetLabel}
                  trailing={activeTarget.locked ? <RestoreControl state={activeTarget} compact /> : null}
                />
              )}
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
                    dot: itemDirty(item.id) ? "warn" : activeLocks[keyOf("item", item.id)] ? "success" : undefined,
                  }))}
                />
              ) : null}
            </div>

            <div className="mt-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
              {panel === "theme" ? (
                <div className="xl:overflow-y-auto xl:pr-1">
                  <ThemeInspector
                    state={themeTargetState}
                    theme={themeDraft}
                    onTheme={setThemeDraft}
                    onImage={async (target, file) => {
                      const id = await uploadImage("theme", documentId, file);
                      if (id) setThemeDraft(current => ({ ...current, [target]: id }));
                    }}
                  />
                </div>
              ) : panel === "background" ? (
                <div className="xl:overflow-y-auto xl:pr-1">
                  {savedPage && pageTargetState ? (
                    <PageInspector
                      state={pageTargetState}
                      pageNumber={previewPage?.no ?? (snapshot.document.series === "weekly" ? currentIndex : currentIndex + 2)}
                      color={pageColors[savedPage.id] ?? savedPage.bgColor ?? FALLBACK_PAGE_COLOR}
                      defined={Boolean(pageColors[savedPage.id] ?? savedPage.bgColor)}
                      onColor={value => setPageColors(current => ({ ...current, [savedPage.id]: value }))}
                    />
                  ) : (
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>背景を編集できる画像がありません。</p>
                  )}
                </div>
              ) : activeItem && page && (page.kind === "adopted" || page.kind === "listed" || page.kind === "feature" || page.kind === "others") && itemTargetState ? (
                <ItemInspector
                  key={`${activeItem.id}:${snapshot.itemVersions[activeItem.id]}`}
                  item={activeItem}
                  draft={drafts[activeItem.id]}
                  pageKind={page.kind}
                  diagnostic={bodyDiagnostic.find(value => value.slotId === activeItem.id) || null}
                  state={itemTargetState}
                  onDraft={content => setDrafts(current => ({ ...current, [activeItem.id]: content }))}
                  onImage={file => uploadImage("item", activeItem.id, file)}
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
              async () => {
                const lock = await acquire("structure", documentId);
                if (lock) setStructurePages(snapshot.document.pages.map(value => ({ ...value, itemIds: [...value.itemIds] })));
              },
              () => void save("structure", documentId, {
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
}
