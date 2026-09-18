"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { canvasPreviewPage, type CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorSnapshot } from "@/lib/generator/client-types";
import type { GeneratorDocument, GeneratorItemSource, ItemContent } from "@/lib/generator/model";
import type { ReimportDiff } from "@/lib/generator/reimport";
import { getMemberShortName } from "@/lib/members";
import type { ReleaseMasterAlbum } from "@/lib/types";
import BulkExportButton from "../BulkExportButton";
import GeneratorPreview, { type PreviewDiagnostics, type PreviewSelection } from "../GeneratorPreview";
import PageNavigator from "../PageNavigator";
import { generatorJson, snapshotWithLocks, type GeneratorApiError } from "../generator-client";
import { CoverColorProbe } from "../cover-color-client";
import { GeneratorRuntimeProvider } from "../runtime";
import { Chip, Modal, Panel, PrimaryButton, SecondaryButton, SegmentedControl, SelectInput, StatusBanner, useMediaQuery } from "../ui";
import { PageInspector, RestoreControl, StructureDialog, type TargetState } from "./Inspectors";
import ItemInspector from "./ItemInspector";
import SourceUpdateDialog, { type SourceUpdate } from "./SourceUpdateDialog";
import { clearRecovery, readRecovery, writeRecovery } from "./recovery";
import { collectSources, pendingSourceUpdates, sourceChanged } from "./source-payload";
import { useGeneratorSession } from "./session";
import { applySourceRefresh, collectSourceRefresh, indexAlbums, matchAlbum, type RefreshFieldKey, type SourceRefreshItem } from "./source-refresh";
import {
  cloneContent,
  derivePageBadges,
  imageSaveTargets,
  keyOf,
  pageEditBlocker,
  recoveryHasChanges,
  same,
  targetLabels,
  type ActiveLock,
  type FieldSelection,
  type LockKind,
} from "./workspace-types";


const seriesLabels: Record<GeneratorDocument["series"], string> = {
  monthly: "Monthly Review",
  japan: "Monthly Japan Review",
  weekly: "Weekly Review",
};

const FALLBACK_PAGE_COLOR = "#475569";
/** 最初の3ステップの案内を閉じたことを覚えるキー。読めなくても案内が出るだけで壊れない。 */
const GUIDE_KEY = "ryuryu_generator_guide";
const savedAtFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" });

function pageKindLabel(kind: GeneratorDocument["pages"][number]["kind"]): string {
  return { cover: "表紙", feature: "メイン", others: "Other Releases", adopted: "採用", listed: "掲載" }[kind];
}

/** ロックの持ち主はメールで届く。メンバーなら短い名前で見せる。 */
function memberName(email: string): string {
  return getMemberShortName(email) ?? email;
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
  const session = useGeneratorSession({ initialSnapshot, actor });
  const { snapshot, setSnapshot, documentId, busy, setBusy, status, setStatus, activeLocks, locksRef, history, pendingSaves } = session;

  const [pageIndex, setPageIndex] = useState(0);
  const [slotIndex, setSlotIndex] = useState(0), [reorderOpen, setReorderOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ItemContent>>({});
  /** 保存時に作品と一緒に送る、進んだ取り込み基準。カバー画像の差し替えもここに入る。 */
  const [pendingSources, setPendingSources] = useState<Record<string, GeneratorItemSource>>({});
  const [pageColors, setPageColors] = useState<Record<string, string>>({});
  const [structurePages, setStructurePages] = useState<GeneratorDocument["pages"] | null>(null);
  /** Release Masterを読み直した結果。作品の増減と文字情報を1つのダイアログで確認する。 */
  const [sourceUpdate, setSourceUpdate] = useState<{ diff: ReimportDiff; refresh: SourceRefreshItem[]; sources: Record<string, GeneratorItemSource>; refreshError: string | null } | null>(null);
  const [diagnostics, setDiagnostics] = useState<PreviewDiagnostics | null>(null);
  const [selectionState, setSelectionState] = useState<FieldSelection | null>(null);
  /** 開いたとき、このブラウザの一時保存に保存済みと違う内容が残っていたか。そのときだけ知らせる。 */
  const [recoveryOffer, setRecoveryOffer] = useState(false);
  /** 一時保存に書けなかった（容量不足・無効化など）。書けないときだけ知らせる。 */
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  /** 最初の3ステップの案内。閉じたらこのブラウザで覚える。 */
  const [guideOpen, setGuideOpen] = useState(false);
  /** 未保存があるまま「最新のバージョンを読み込む」を押したときの確認。 */
  const [reloadPrompt, setReloadPrompt] = useState(false);
  /** 編集中の画像。画像を選ぶと自動で始まり、別の画像へ移る・並び順を開く・画面を離れると終わる。 */
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  /**
   * 画像を選んだときの編集開始の経過。取得中・他の編集に止められている・失敗を、編集パネルの中で説明する。
   * 失敗したら同じ画像で繰り返し取りにいかない（ここがnullに戻ったときだけ取り直す）。
   */
  const [editAttempt, setEditAttempt] = useState<{ pageId: string; phase: "acquiring" | "blocked" | "failed"; message?: string } | null>(null);
  /**
   * 背景色が未設定の画像へ、編集開始時に入れた仮の初期値。これだけの変更は「未保存」に数えない。
   * 見て回っただけで保存の確認が出続けるのを避けるため。画像を離れるときに捨てる。
   */
  const [autoColors, setAutoColors] = useState<Record<string, string>>({});
  const autoColorsRef = useRef<Record<string, string>>({});
  /** 未保存のまま画像を離れようとしたときの確認。`then`は保存か破棄の後に続ける操作。 */
  const [leavePrompt, setLeavePrompt] = useState<{ then: () => void } | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [structurePrompt, setStructurePrompt] = useState(false);
  /** 並び順のダイアログの中で出す、編集を始められない理由。ダイアログが画面上部の帯を覆うため。 */
  const [structureNotice, setStructureNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 変更を破棄したら、入力欄の取り消し履歴も捨てる（破棄前の内容へ戻れてしまわないように）。 */
  const [inspectorEpoch, setInspectorEpoch] = useState(0);
  /** ジャケットから拾った背景色の候補。画像ごとに1度だけ計算する。 */
  const [colorCandidates, setColorCandidates] = useState<Record<string, string[]>>({});
  /** 編集開始の非同期処理の途中で候補が届いても拾えるよう、最新の候補を参照で持つ。 */
  const colorCandidatesRef = useRef<Record<string, string[]>>({});
  const durationHydratedDocument = useRef<string | null>(null);
  /** 非同期の取得が終わった時点で、まだ同じ画像を見ているかを確かめる。 */
  const currentPageIdRef = useRef<string | null>(null);
  /** 返している途中のロック。次のロック取得はこれを待つ（DBが画像と並び順の同時ロックを拒むため）。 */
  const pendingRelease = useRef<Promise<void>>(Promise.resolve());
  const router = useRouter();
  const loadMenuRef = useRef<HTMLDetailsElement>(null);

  // 「読み込み」メニューは、外を押したら閉じる（detailsは自分では閉じないため）。
  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      const menu = loadMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, []);

  const wide = useMediaQuery("(min-width: 1280px)");
  // iPhoneでは字間の調整を出さない（範囲選択がページのスクロールと両立しないため）。
  // 保存済みの tracking / kerns はそのまま描画・保存され続ける。
  const phone = useMediaQuery("(max-width: 639px), (pointer: coarse) and (max-height: 500px)");
  const items = useMemo(() => new Map(snapshot.document.items.map(item => [item.id, item])), [snapshot.document.items]);
  const previewDocument = useMemo<GeneratorDocument>(() => ({
    ...snapshot.document,
    pages: (structurePages || snapshot.document.pages).map(value => ({ ...value, bgColor: pageColors[value.id] ?? value.bgColor })),
    items: snapshot.document.items.map(item => ({
      ...item,
      source: pendingSources[item.id] || item.source,
      content: drafts[item.id] || item.content,
    })),
  }), [drafts, pageColors, pendingSources, snapshot.document, structurePages]);
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

  const itemDirty = useCallback(
    (id: string) => (Boolean(drafts[id]) && !same(drafts[id], items.get(id)?.content)) || Boolean(pendingSources[id]),
    [drafts, items, pendingSources],
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
        if (durations.size) setStatus({ tone: "success", text: `Release Masterから空欄の曲数・総尺を${durations.size}件読み込みました。画像ごとに「保存」すると確定します。` });
      })
      .catch(() => {
        // 曲数・総尺が空の作品があるときだけ言う。空欄が無ければ、読めなくても困らない。
        if (cancelled || !snapshot.document.items.some(item => !item.content.fields.duration.trim())) return;
        setStatus({ tone: "warn", text: "空欄の曲数・総尺をRelease Masterから読み込めませんでした。必要なら手で入力してください。" });
      });
    return () => { cancelled = true; };
  }, [documentId, setStatus, snapshot.document.items]);

  // 開いた時点の一時保存が、保存済みの内容と違うときだけ知らせる。
  // 一時保存は保存しても消えないので、「残っている」だけで出すと毎回出てしまう。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setRecoveryOffer(recoveryHasChanges(readRecovery(actor, documentId).document, session.snapshotRef.current.document));
      } catch {
        setRecoveryOffer(false);
      }
      try {
        setGuideOpen(window.localStorage.getItem(GUIDE_KEY) !== "closed");
      } catch {
        setGuideOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [actor, documentId, session.snapshotRef]);

  // 一時保存には、編集開始時に自動で入れた仮の背景色を入れない（次に開いたとき「変更が残っている」と誤って知らせないため）。
  const recoveryDocument = useMemo<GeneratorDocument>(() => ({
    ...previewDocument,
    pages: previewDocument.pages.map(value => autoColors[value.id] !== undefined && value.bgColor === autoColors[value.id]
      ? { ...value, bgColor: snapshot.document.pages.find(saved => saved.id === value.id)?.bgColor ?? null }
      : value),
  }), [autoColors, previewDocument, snapshot.document.pages]);
  const recoveryDirty = !same(recoveryDocument, snapshot.document);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!recoveryDirty) return;
      setRecoveryFailed(!writeRecovery({ actor, documentId, baseVersion: snapshot.version, document: recoveryDocument }));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [actor, documentId, recoveryDirty, recoveryDocument, snapshot.version]);

  // 操作の結果（成功・案内）は数秒で消す。警告とエラーは、次の操作まで残す。
  useEffect(() => {
    if (!status.text || (status.tone !== "success" && status.tone !== "info")) return;
    const timer = window.setTimeout(() => setStatus({ tone: "info", text: "" }), 6000);
    return () => window.clearTimeout(timer);
  }, [setStatus, status]);

  // 背景色の候補はジャケットの画素から拾う。表紙は作品を持たないので、最初のメインのジャケットを使う。
  const colorSource = previewPage?.kind === "cover" ? previewPages.find(value => value.kind === "feature") || null : previewPage;
  const updateAutoColors = useCallback((update: (current: Record<string, string>) => Record<string, string>) => {
    autoColorsRef.current = update(autoColorsRef.current);
    setAutoColors(autoColorsRef.current);
  }, []);
  const rememberColors = useCallback((pageId: string, colors: string[]) => {
    if (!colorCandidatesRef.current[pageId]) colorCandidatesRef.current = { ...colorCandidatesRef.current, [pageId]: colors };
    setColorCandidates(current => current[pageId] ? current : { ...current, [pageId]: colors });
    // 候補が出る前に編集を始めた画像は、仮の色のままになっている。自動の初期値のうちは候補の先頭へ差し替える。
    const auto = autoColorsRef.current[pageId], first = colors[0];
    if (auto === undefined || !first || auto === first) return;
    setPageColors(current => current[pageId] === auto ? { ...current, [pageId]: first } : current);
    updateAutoColors(current => ({ ...current, [pageId]: first }));
  }, [updateAutoColors]);

  const handleDiagnostics = useCallback((value: PreviewDiagnostics) => setDiagnostics(value), []);

  async function reload() {
    setBusy(true);
    const next = await session.fetchSnapshot();
    if (next) {
      durationHydratedDocument.current = null;
      setSnapshot(next);
      setEditingPageId(null);
      setDrafts({});
      setPendingSources({});
      setPageColors({});
      setStructurePages(null);
      setSourceUpdate(null);
      pendingSaves.clear();
      setStatus({ tone: "success", text: "最新のバージョンを読み込みました。" });
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

  /** 背景色が、編集開始時に自動で入れた仮の初期値のままか。 */
  function isAutoColor(pageId: string): boolean {
    return autoColors[pageId] !== undefined && pageColors[pageId] === autoColors[pageId];
  }

  /** その画像で共有DBへ送る対象。自動の初期値だけの背景色も含む（「保存」を押せば確定できるように）。 */
  function saveTargetsFor(pageId: string) {
    const target = (structurePages || snapshot.document.pages).find(value => value.id === pageId);
    if (!target) return [];
    return imageSaveTargets({
      page: target,
      savedBgColor: snapshot.document.pages.find(value => value.id === pageId)?.bgColor ?? null,
      pageColors,
      titleOf: id => items.get(id)?.content.fields.title || "",
      isItemDirty: itemDirty,
    });
  }

  /** 利用者が実際に変えたもの。自動の初期値だけの背景色は数えない。保存の確認と「未保存」の表示に使う。 */
  function changesFor(pageId: string) {
    return saveTargetsFor(pageId).filter(target => !(target.kind === "page" && isAutoColor(pageId)));
  }

  function dropAutoColor(pageId: string) {
    const auto = autoColorsRef.current[pageId];
    if (auto === undefined) return;
    setPageColors(current => {
      if (current[pageId] !== auto) return current;
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    updateAutoColors(current => {
      const next = { ...current };
      delete next[pageId];
      return next;
    });
  }

  /**
   * 画像の編集を始める。画像を選ぶと自動で呼ばれる。背景のロックを取り、作品のロックは下の効果が取る。
   * 始められないときは画面上部ではなく、編集パネルの中で理由と次の操作を示す。
   */
  async function beginImageEdit(pageId: string, action: "acquire" | "transfer" = "acquire") {
    setEditAttempt({ pageId, phase: "acquiring" });
    await pendingRelease.current;
    // 並び順を閉じた後にこの画面の並び順ロックが残っていると、DBが画像のロックを拒む。先に返す。
    const strayStructure = locksRef.current[keyOf("structure", documentId)];
    if (strayStructure) await session.releaseMany([strayStructure]);
    const result = await session.tryAcquire("page", pageId, action);
    // 取得中に別の画像へ移ったら、取れたロックはすぐ返す。
    if (currentPageIdRef.current !== pageId) {
      if (result.ok) pendingRelease.current = session.releaseMany([result.lock]);
      return;
    }
    if (!result.ok) {
      if (result.error.code === "LOCK_CONFLICT") {
        await session.refreshLocks();
        setEditAttempt({ pageId, phase: "blocked" });
      } else {
        setEditAttempt({ pageId, phase: "failed", message: result.error.message });
      }
      return;
    }
    if (action === "transfer") {
      // 別の画面が持っていた作品のロックも引き取る。取らないと作品の欄だけ直せないまま残る。
      const target = (structurePages || snapshot.document.pages).find(value => value.id === pageId);
      const mine = session.snapshotRef.current.locks.filter(lock => lock.kind === "item" && lock.owner === actor
        && target?.itemIds.includes(lock.targetId) && !locksRef.current[keyOf("item", lock.targetId)]);
      for (const lock of mine) await session.tryAcquire("item", lock.targetId, "transfer");
    }
    // 背景色が未設定の画像は、ジャケットから拾った候補の先頭を仮の初期値にする。
    // 決めるのは人なので、そのまま保存もできるし、候補やカラーピッカーで直してもよい。
    const savedColor = snapshot.document.pages.find(value => value.id === pageId)?.bgColor ?? null;
    if (savedColor === null && pageColors[pageId] === undefined) {
      const initial = colorCandidatesRef.current[pageId]?.[0] ?? FALLBACK_PAGE_COLOR;
      updateAutoColors(current => ({ ...current, [pageId]: initial }));
      setPageColors(current => current[pageId] !== undefined ? current : { ...current, [pageId]: initial });
    }
    attemptedItems.current.clear();
    setEditingPageId(pageId);
    setEditAttempt(null);
  }

  /**
   * いまの画像を離れる。ロックは持ち歩かない（見て回っただけで他の人を止めないため）。
   * 未保存の変更があるときは、呼ぶ前に保存か破棄を選んでもらう（`requestLeave`）。
   */
  function leaveImage(then: () => void) {
    const pageId = page?.id ?? null;
    const held = pageId ? locksForPage(pageId) : [];
    if (pageId) dropAutoColor(pageId);
    setEditingPageId(null);
    setEditAttempt(null);
    then();
    if (held.length) pendingRelease.current = session.releaseMany(held);
  }

  function requestLeave(then: () => void) {
    if (page && changesFor(page.id).length > 0) {
      setLeavePrompt({ then });
      return;
    }
    leaveImage(then);
  }

  /** その画像の未保存の変更を捨てる。作品の下書き・取り込み基準・背景色が対象。 */
  function discardImage(pageId: string) {
    const target = (structurePages || snapshot.document.pages).find(value => value.id === pageId);
    if (!target) return;
    const keys = new Set([...target.itemIds, pageId]);
    const omit = <T,>(current: Record<string, T>) => Object.fromEntries(Object.entries(current).filter(([id]) => !keys.has(id)));
    setDrafts(omit);
    setPendingSources(omit);
    setPageColors(omit);
    updateAutoColors(omit);
    setInspectorEpoch(value => value + 1);
  }

  // 画像を選んだら、そのまま編集を始める。止められたときは理由を出して待ち、繰り返し取りにいかない。
  const currentPageId = page?.id ?? null;
  const pausedForDialog = reorderOpen || Boolean(sourceUpdate) || Boolean(leavePrompt);
  const beginRef = useRef(beginImageEdit);
  useEffect(() => {
    beginRef.current = beginImageEdit;
    currentPageIdRef.current = currentPageId;
  });
  useEffect(() => {
    if (!currentPageId || pausedForDialog || editingPageId === currentPageId || editAttempt?.pageId === currentPageId) return;
    const timer = window.setTimeout(() => {
      currentPageIdRef.current = currentPageId;
      void beginRef.current(currentPageId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentPageId, editAttempt?.pageId, editingPageId, pausedForDialog]);

  // 他の人の編集で止まっている間は、20秒ごとに取り直す。終われば、そのまま編集できるようになる。
  const blockedPhase = editAttempt?.phase === "blocked";
  useEffect(() => {
    if (!blockedPhase) return;
    const timer = window.setInterval(() => setEditAttempt(null), 20000);
    return () => window.clearInterval(timer);
  }, [blockedPhase]);

  // 編集中に別の作品へ切り替えたら、その作品のロックも取る（1画像の中で続けて直せるようにする）。
  // 取りにいった作品を覚えておく。失敗しても同じ作品を繰り返し取りにいかない（描画のたびに走るため）。
  // 編集を始め直すと`beginImageEdit`が空に戻す。
  const attemptedItems = useRef(new Set<string>());
  const itemLockHeld = Boolean(activeItem && activeLocks[keyOf("item", activeItem.id)]);
  const editingPageLocked = Boolean(page && editingPageId === page.id && activeLocks[keyOf("page", page.id)]);
  useEffect(() => {
    // 背景のロックを失っている間は取りにいかない。「編集権が切れました」から始め直してもらう。
    if (!page || !editingPageLocked || !activeItem || itemLockHeld) return;
    if (attemptedItems.current.has(activeItem.id)) return;
    attemptedItems.current.add(activeItem.id);
    const pageId = page.id, item = activeItem;
    void (async () => {
      const result = await session.tryAcquire("item", item.id);
      if (!result.ok) {
        if (currentPageIdRef.current === pageId) {
          setStatus({ tone: "warn", text: `作品「${item.content.fields.title || "作品名未入力"}」はほかの画面で編集中のため、いまは直せません。` });
        }
        return;
      }
      // 取得中に画像を離れていたら、持ち歩かずに返す。
      if (currentPageIdRef.current !== pageId) {
        pendingRelease.current = session.releaseMany([result.lock]);
        return;
      }
      setDrafts(current => current[item.id] ? current : { ...current, [item.id]: cloneContent(item.content) });
    })();
  }, [activeItem, editingPageLocked, itemLockHeld, page, session, setStatus]);

  /**
   * いま開いている画像を保存する。作品（掲載なら上下、Othersなら触った分）と背景色を続けて確定する。
   * まとめて確定するAPIが無いため、途中で失敗したら成功分はそのまま残し、失敗した対象を知らせて再試行させる。
   */
  async function saveImage(): Promise<boolean> {
    if (!page) return false;
    const targets = saveTargetsFor(page.id);
    if (!targets.length) return true;
    setBusy(true);
    setSaving(true);
    setStatus({ tone: "info", text: `保存しています…（${targets.length}件）` });
    const saved: string[] = [], failed: string[] = [];
    // 対象別の競合はその対象だけの失敗なので、残りは続ける。
    // 認証・認可の失敗は残りも通らないので中止し、通信断・5xxは確定済みか不明なのでそこで列を止める。
    let halted: { label: string; reason: string } | null = null;
    for (const target of targets) {
      // Time補完やRelease Masterの読み直しで下書きになった作品は、まだロックを持っていないことがある。保存の直前に取る。
      if (target.kind === "item" && !session.holds("item", target.targetId)) {
        const got = await session.tryAcquire("item", target.targetId);
        if (!got.ok) {
          failed.push(target.label);
          continue;
        }
      }
      const content = target.kind === "item"
        ? drafts[target.targetId] || items.get(target.targetId)?.content
        : { bgColor: pageColors[page.id] };
      const result = await session.saveTarget({
        kind: target.kind,
        targetId: target.targetId,
        content,
        ...(target.kind === "item" && pendingSources[target.targetId] ? { source: pendingSources[target.targetId] } : {}),
      });
      if (result.ok) {
        saved.push(target.label);
        if (target.kind === "item") {
          const next = result.snapshot.document.items.find(item => item.id === target.targetId);
          if (next) setDrafts(current => ({ ...current, [target.targetId]: cloneContent(next.content) }));
          setPendingSources(current => {
            if (!current[target.targetId]) return current;
            const remaining = { ...current };
            delete remaining[target.targetId];
            return remaining;
          });
        } else {
          const next = result.snapshot.document.pages.find(value => value.id === target.targetId);
          if (next) setPageColors(current => ({ ...current, [target.targetId]: next.bgColor || FALLBACK_PAGE_COLOR }));
          // 保存した色はもう仮の初期値ではない。
          updateAutoColors(current => {
            const rest = { ...current };
            delete rest[target.targetId];
            return rest;
          });
        }
        continue;
      }
      const status = result.error.status;
      // 取り込み基準を載せた保存は、共有DBにsource更新のマイグレーションが未適用だと必ず失敗する。
      // 503は接続不良と区別が付かないので、何を一緒に送ったかを言う。
      const carriedSource = target.kind === "item" && Boolean(pendingSources[target.targetId]);
      const reason = result.error.code === "VERSION_CONFLICT" || result.error.code === "LOCK_LOST"
        ? "ほかの人の保存が先に入りました。「読み込み」から「最新のバージョンを読み込む」を押してください。"
        : carriedSource
          ? `${result.error.message} この作品はRelease Masterから取り込んだ内容（カバー画像を含む）も一緒に送っています。`
          : result.error.message;
      if (status === 401 || status === 403) { halted = { label: target.label, reason }; break; }
      if (status === undefined || status >= 500) { halted = { label: target.label, reason }; break; }
      failed.push(target.label);
    }
    setBusy(false);
    setSaving(false);
    if (halted) {
      setStatus({
        tone: "error",
        text: saved.length
          ? `${saved.join("・")}は保存しました。${halted.label}で止まりました: ${halted.reason}`
          : `${halted.label}を保存できませんでした: ${halted.reason}`,
      });
      return false;
    }
    if (failed.length) {
      setStatus({
        tone: "error",
        text: saved.length
          ? `${saved.join("・")}は保存しました。${failed.join("・")}は保存できていません。`
          : `${failed.join("・")}を保存できませんでした。`,
      });
      return false;
    }
    setStatus({ tone: "success", text: `画像 ${pageNumber} を保存しました（${saved.join("・")}）。` });
    return true;
  }

  /** 対象1つだけの保存・復元。並び順モーダルと、過去版からの復元で使う。 */
  async function saveSingle(kind: LockKind, targetId: string, content?: unknown, restoreVersion?: number): Promise<boolean> {
    setBusy(true);
    setStatus({ tone: "info", text: restoreVersion ? "以前の保存に戻しています…" : "保存しています…" });
    const result = await session.saveTarget({ kind, targetId, content, restoreVersion });
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error.code === "VERSION_CONFLICT" || result.error.code === "LOCK_LOST"
        ? { tone: "error", text: "ほかの人の保存が先に入りました。「読み込み」から「最新のバージョンを読み込む」を押してから、もう一度直してください。" }
        : { tone: "error", text: result.error.message });
      return false;
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
        ? `${targetLabels[kind]}を以前の保存に戻しました（戻したことも履歴に残ります）。`
        : `${targetLabels[kind]}を保存しました。`,
    });
    return true;
  }

  /**
   * Release Masterをもう一度読み、作品の増減と文字情報の差分をまとめて確認する。
   * 読み取りだけなので編集ロックは取らない。下書きがあっても差分を確認できる。
   */
  async function openSourceUpdate() {
    setBusy(true);
    setStatus({ tone: "info", text: "Release Masterを読み直しています…" });
    try {
      // 作品の増減はサーバーがRelease Masterを読んで返す。文字情報はブラウザから別途読む。
      // 片方が落ちても、取れたほうだけで判断できるようにする（シートの一時的な失敗で全部止めない）。
      const diff = await generatorJson<ReimportDiff>(await fetch(`/api/generator/documents/${documentId}/reimport`, { cache: "no-store" }));
      let refresh: SourceRefreshItem[] = [], sources: Record<string, GeneratorItemSource> = {}, refreshError: string | null = null;
      try {
        const albums = await generatorJson<ReleaseMasterAlbum[]>(await fetch("/api/release-master", { cache: "no-store" }));
        refresh = collectSourceRefresh({ document: snapshot.document, drafts, albums });
        const albumIndex = indexAlbums(albums);
        sources = collectSources({
          document: snapshot.document,
          albums,
          matchAlbum: item => matchAlbum(item, albumIndex),
          importedAt: new Date().toISOString(),
        });
      } catch (error) {
        refreshError = (error as Error).message;
      }
      setSourceUpdate({ diff, refresh, sources, refreshError });
      const structureCount = diff.added.length + diff.removed.length + diff.moved.length;
      const fieldCount = refresh.reduce((count, item) => count + item.changes.length, 0);
      setStatus(refreshError
        ? { tone: "warn", text: `作品の増減・区分は${structureCount}件あります。文字情報は読み込めませんでした: ${refreshError}` }
        : structureCount || fieldCount
          ? { tone: "warn", text: `作品の増減・区分が${structureCount}件、文字情報が${fieldCount}件あります。反映する内容を選んでください。` }
          : { tone: "success", text: "Release Masterと同じ内容です。更新するものはありません。" });
    } catch (error) {
      setStatus({ tone: "error", text: `Release Masterを読み直せませんでした: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function closeSourceUpdate() {
    setSourceUpdate(null);
    // POSTの応答が不明だった場合は再試行用にstructureロックを保持する。利用者が閉じたら返す。
    pendingRelease.current = session.release("structure", documentId);
    await pendingRelease.current;
  }

  /**
   * 作品構成を確定する直前にだけstructureロックを取る。
   * DBはpageとstructureの同時ロックを拒否するため、自分の画像ロックはここで返す。
   */
  async function acquireReimportLock(removeItemIds: string[]): Promise<ActiveLock | null> {
    // 先に共有DBのロックを確認し、既知の競合があるときは自分の画像編集を終わらせない。
    const latest = await session.fetchSnapshot();
    if (!latest) return null;
    const removed = new Set(removeItemIds);
    const localStructure = locksRef.current[keyOf("structure", documentId)];
    const blocked = latest.locks.some(lock => (lock.kind === "page" && lock.owner !== actor)
      || (lock.kind === "structure" && !localStructure)
      || (lock.kind === "item" && removed.has(lock.targetId) && lock.owner !== actor));
    if (blocked) {
      setStatus({
        tone: "error",
        text: "差分は確認できますが、作品構成はいま確定できません。ほかの人が画像・削除対象を編集しているか、"
          + "別の画面で構成を更新しています。"
          + "編集が終わってから、もう一度実行してください。",
      });
      return null;
    }
    const held = Object.values(locksRef.current).filter(entry => entry.kind === "item" || entry.kind === "page");
    if (held.length) {
      await session.releaseMany(held);
      setEditingPageId(null);
    }
    // 同じ利用者の別端末に残る画像ロックは引き取って返す。他の利用者のロックには触れない。
    const mineElsewhere = latest.locks.filter(lock => (lock.kind === "item" || lock.kind === "page")
      && lock.owner === actor && !locksRef.current[keyOf(lock.kind as LockKind, lock.targetId)]);
    for (const foreignLock of mineElsewhere) {
      const taken = await session.acquire(foreignLock.kind as LockKind, foreignLock.targetId, "transfer");
      if (taken) await session.release(foreignLock.kind as LockKind, foreignLock.targetId);
    }
    const lock = await session.acquire("structure", documentId);
    if (!lock) {
      setStatus({
        tone: "error",
        text: "差分は確認できますが、作品構成はいま確定できません。ほかの編集操作と重なりました。"
          + "編集が終わってから、もう一度実行してください。",
      });
    }
    return lock;
  }

  /**
   * 更新を実行する。作品の増減を新しいversionとして確定してから、文字情報を下書きへ入れる。
   * 構成変更後の作品IDへ文字差分を当てるため、この順序を維持する。
   */
  async function applySourceUpdate(value: SourceUpdate) {
    const structureChanged = value.addKeys.length > 0 || value.removeItemIds.length > 0 || value.resort
      || (sourceUpdate?.diff.moved.length || 0) > 0;
    let document = snapshot.document;
    if (structureChanged) {
      const lock = await acquireReimportLock(value.removeItemIds);
      if (!lock) return;
      const next = await runReimport(value, lock);
      if (!next) return;
      document = next.document;
    } else {
      // 通常は未取得。結果不明の構成保存を取りやめて選択を変えた場合だけ、保持中のロックを返す。
      pendingRelease.current = session.release("structure", documentId);
      await pendingRelease.current;
    }
    const sources = sourceUpdate?.sources || {};
    setSourceUpdate(null);
    applyFieldUpdates(document, value.fields);
    // 取り込み基準は、利用者が項目を選んだ作品と、カバーが差し替わった作品だけ進める。
    const advanced = pendingSourceUpdates({
      items: document.items,
      sources,
      selectedItemIds: new Set(value.fields.map(field => field.itemId)),
    });
    if (Object.keys(advanced).length) setPendingSources(current => ({ ...current, ...advanced }));
  }

  /** 作品の増減だけを共有DBへ確定する。成功したスナップショットを返す。 */
  async function runReimport(value: SourceUpdate, lock: ActiveLock): Promise<GeneratorSnapshot | null> {
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
    setStatus({ tone: "info", text: "作品の増減を保存しています…" });
    try {
      const next = await generatorJson<GeneratorSnapshot>(await fetch(`/api/generator/documents/${documentId}/reimport`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, ...change }),
      }));
      pendingSaves.delete(requestKey);
      const removed = new Set(value.removeItemIds);
      const retainedLocks = snapshot.locks.filter(entry => !(entry.kind === "structure" && entry.targetId === documentId)
        && !(entry.kind === "item" && removed.has(entry.targetId)));
      durationHydratedDocument.current = null;
      setSnapshot(snapshotWithLocks(next, retainedLocks));
      await session.releaseMany([lock]);
      // 既存作品の内容は取り込み直しで変わらないので、生き残る作品の下書きはそのまま使える。
      // 消えた作品・消えた画像のぶんだけ落とす（行き先が無くなるため）。
      const survivingItems = new Set(next.document.items.map(item => item.id));
      const survivingPages = new Set(next.document.pages.map(value => value.id));
      const keep = <T,>(current: Record<string, T>, alive: ReadonlySet<string>) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => alive.has(id)));
      const discarded = Object.keys(drafts).filter(id => itemDirty(id) && !survivingItems.has(id)).length;
      setDrafts(current => keep(current, survivingItems));
      setPendingSources(current => keep(current, survivingItems));
      setPageColors(current => keep(current, survivingPages));
      setStructurePages(null); setEditingPageId(null);
      setPageIndex(current => Math.min(current, Math.max(0, next.document.pages.length - 1))); setSlotIndex(0);
      // 背景色は画像（ページ）に紐づく。作品が入れ替わった画像はページごと作り直されるので、色は残らない。
      // 実文書（W37、2026-09-12）で確認済み。ここを「保持されています」と言い切らない。
      setStatus({
        tone: discarded ? "warn" : "success",
        text: "作品の増減を保存しました。直していた内容と保存していない変更はそのままです。"
          + "作品が入れ替わった画像は作り直されるので、その画像の背景色は設定し直してください。"
          + (discarded ? `外れた作品${discarded}件の未保存の下書きは破棄しました。` : ""),
      });
      return next;
    } catch (error) {
      const apiError = error as GeneratorApiError;
      if (apiError.status !== undefined && apiError.status < 500) {
        pendingSaves.delete(requestKey);
        await session.releaseMany([lock]);
      }
      setStatus(apiError.code === "VERSION_CONFLICT" || apiError.code === "LOCK_LOST"
        ? { tone: "error", text: "確認している間にほかの人の保存が入りました。「最新のバージョンを読み込む」を押してから、もう一度確認してください。" }
        : { tone: "error", text: apiError.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** 文字情報を下書きへ入れる。作品の増減で消えた作品ぶんは黙って落とす。 */
  function applyFieldUpdates(document: GeneratorDocument, selected: SourceUpdate["fields"]) {
    const alive = new Map(document.items.map(item => [item.id, item]));
    const grouped = new Map<string, { key: RefreshFieldKey; next: string }[]>();
    for (const value of selected) {
      if (!alive.has(value.itemId)) continue;
      const changes = grouped.get(value.itemId) || [];
      changes.push({ key: value.key, next: value.next });
      grouped.set(value.itemId, changes);
    }
    if (!grouped.size) return;
    setDrafts(current => {
      const next = { ...current };
      for (const [itemId, changes] of grouped) {
        const base = current[itemId] || alive.get(itemId)?.content;
        if (!base) continue;
        next[itemId] = applySourceRefresh(cloneContent(base), changes);
      }
      return next;
    });
    const pageNumbers = [...new Set(document.pages
      .map((page, index) => ({ page, no: document.series === "weekly" ? index : index + 2 }))
      .filter(({ page }) => page.itemIds.some(id => grouped.has(id)))
      .map(({ no }) => no))].sort((left, right) => left - right);
    const count = [...grouped.values()].reduce((sum, changes) => sum + changes.length, 0);
    setStatus({
      tone: "warn",
      text: `Release Masterの文字を${count}件入れました（まだ保存していません）。画像 ${pageNumbers.join("・")} を開いて「保存」してください。`,
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
      if (!sameItems || !samePages) throw new Error("その後に作品や画像の構成が変わったため、安全に開けません。");
      setDrafts(Object.fromEntries([...currentItems].flatMap(id => recoveredItems.has(id) ? [[id, cloneContent(recoveredItems.get(id)!)] as const] : [])));
      // 取り込み基準（カバー画像を含む）も退避してあるので、保存済みと違う分だけ戻す。
      setPendingSources(Object.fromEntries(recovered.items.flatMap(item => {
        const saved = snapshot.document.items.find(value => value.id === item.id);
        return saved && item.source.kind === "release-master" && sourceChanged(saved.source, item.source)
          ? [[item.id, item.source] as const]
          : [];
      })));
      setPageColors(Object.fromEntries(recovered.pages
        .filter(value => snapshot.document.pages.some(current => current.id === value.id) && value.bgColor)
        .map(value => [value.id, value.bgColor!] as const)));
      setStructurePages(snapshot.document.pages.map(current => ({
        ...current,
        itemIds: [...recoveredPages.get(current.id)!.itemIds],
      })));
      const themeChanged = !same(recovered.theme, snapshot.document.theme);
      setRecoveryOffer(false);
      setStatus({
        tone: "warn",
        text: themeChanged
          ? "前回の保存していない変更を開きました。共通設定にも変更が残っています。共通設定の画面で開いてください。"
          : "前回の保存していない変更を開きました。画像ごとに確認して「保存」してください。",
      });
    } catch (error) {
      setStatus({ tone: "error", text: `前回の変更を開けませんでした: ${(error as Error).message}` });
    }
  }

  function discardRecovery() {
    clearRecovery(actor, documentId);
    setRecoveryOffer(false);
    setStatus({ tone: "info", text: "前回の保存していない変更を捨てました。" });
  }

  const restoreVersions = history.filter(entry => entry.version < snapshot.version);
  const latestReimportVersion = history.find(entry => entry.operation === "reimport")?.version || 0;
  const savedPage = page ? snapshot.document.pages.find(value => value.id === page.id) || null : null;
  // 未保存の背景色は表示中のページ以外にもあり得る。書き出せない理由には全ページ分を挙げる。
  const dirtyPages = snapshot.document.pages
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => pageColors[value.id] !== undefined && pageColors[value.id] !== value.bgColor && !isAutoColor(value.id));
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
  const imageChanges = page ? changesFor(page.id) : [];
  const imageDirty = imageChanges.length > 0;
  /** 保存できるもの。自動で入れた背景色だけのときも、保存すれば確定できる。 */
  const imageSavable = Boolean(page && saveTargetsFor(page.id).length > 0);
  const imageAutoColorOnly = Boolean(page && !imageDirty && isAutoColor(page.id));
  const pageLockHeld = Boolean(page && activeLocks[keyOf("page", page.id)]);
  const imageEditing = Boolean(page && editingPageId === page.id && pageLockHeld);
  /** 編集していたのにロックが消えた（通信断・別画面への引き継ぎ）。下書きは残っている。 */
  const imageEditLost = Boolean(page && editingPageId === page.id && !pageLockHeld);
  const attempt = page && editAttempt?.pageId === page.id ? editAttempt : null;
  const blocker = page
    ? pageEditBlocker({ page, documentId, locks: snapshot.locks, isHeld: (kind, id) => Boolean(activeLocks[keyOf(kind, id)]), actor })
    : null;
  const pageNumber = previewPage?.no ?? (snapshot.document.series === "weekly" ? currentIndex : currentIndex + 2);

  /** この画像が最後に保存されたのはいつか。文書の通し番号ではなく、画像ごとに見せる。 */
  const imageSaved = page
    ? history.find(entry => (entry.targetKind === "item" && page.itemIds.includes(entry.targetId || ""))
      || (entry.targetKind === "page" && entry.targetId === page.id)) || null
    : null;

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
  const bodyDiagnostic = diagnostics && previewPage && diagnostics.pageId === previewPage.id ? diagnostics.body : [];

  function selectPage(index: number) {
    const nextPage = visiblePages[index];
    if (!nextPage || nextPage.id === page?.id) return;
    // 未保存の変更があれば、保存するか破棄するかを先に選んでもらう。
    requestLeave(() => {
      setPageIndex(index);
      setSlotIndex(0);
    });
  }

  /** 画面内のリンク（企画一覧・共通設定・変更履歴）も、未保存なら同じ確認を挟む。 */
  function guardLink(href: string) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (!imageDirty || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      setLeavePrompt({ then: () => router.push(href) });
    };
  }

  async function saveAndLeave() {
    const prompt = leavePrompt;
    if (!prompt) return;
    const ok = await saveImage();
    setLeavePrompt(null);
    // 保存に失敗したら、この画像に留まる。理由は画面上部に出ている。
    if (ok) leaveImage(prompt.then);
  }

  function discardAndLeave() {
    const prompt = leavePrompt;
    if (!prompt || !page) return;
    discardImage(page.id);
    setLeavePrompt(null);
    leaveImage(prompt.then);
    setStatus({ tone: "info", text: `画像 ${pageNumber} の変更を破棄しました。` });
  }

  function discardCurrent() {
    if (!page) return;
    discardImage(page.id);
    setDiscardPrompt(false);
    // 編集は続ける。背景色が未設定なら、仮の初期値を入れ直す。
    const savedColor = snapshot.document.pages.find(value => value.id === page.id)?.bgColor ?? null;
    if (savedColor === null) {
      const initial = colorCandidatesRef.current[page.id]?.[0] ?? FALLBACK_PAGE_COLOR;
      updateAutoColors(current => ({ ...current, [page.id]: initial }));
      setPageColors(current => ({ ...current, [page.id]: initial }));
    }
    setStatus({ tone: "info", text: `画像 ${pageNumber} の変更を破棄しました。` });
  }

  /** 並び順を開く。DBは画像と並び順を同時にロックさせないので、先に画像の編集を終える。 */
  function openReorder() {
    requestLeave(() => {
      setStructureNotice(null);
      setReorderOpen(true);
    });
  }

  async function beginStructureEdit() {
    await pendingRelease.current;
    const result = await session.tryAcquire("structure", documentId);
    if (!result.ok) {
      if (result.error.code === "LOCK_CONFLICT") {
        await session.refreshLocks();
        const others = session.snapshotRef.current.locks
          .filter(lock => !locksRef.current[keyOf(lock.kind as LockKind, lock.targetId)])
          .map(lock => memberName(lock.owner));
        setStructureNotice(others.length
          ? `${[...new Set(others)].join("・")} が画像を編集中のため、並び順はいま変更できません。編集が終わってから「接続を再試行」を押してください。`
          : "ほかの編集と重なりました。少し待ってから「接続を再試行」を押してください。");
      } else {
        setStructureNotice(result.error.message);
      }
      return;
    }
    setStructureNotice(null);
    // 復旧用コピーから戻した並び順があれば、それを残す。
    setStructurePages(current => current ?? snapshot.document.pages.map(value => ({ ...value, itemIds: [...value.itemIds] })));
  }

  function requestCloseReorder() {
    if (structureDirty && session.holds("structure", documentId)) {
      setStructurePrompt(true);
      return;
    }
    closeReorder(false);
  }

  function closeReorder(discard: boolean) {
    if (discard) setStructurePages(null);
    setStructurePrompt(false);
    setStructureNotice(null);
    pendingRelease.current = session.release("structure", documentId);
    setReorderOpen(false);
  }

  async function saveStructureAndClose() {
    const ok = await saveSingle("structure", documentId, {
      pages: (structurePages || snapshot.document.pages).map(value => ({ id: value.id, itemIds: value.itemIds })),
    });
    if (ok) closeReorder(false);
    else setStructurePrompt(false);
  }

  /** プレビューのクリック・ドラッグから、編集パネルの調整対象と選択範囲を決める。 */
  function selectFromPreview(value: PreviewSelection & { touch?: boolean }) {
    // 編集できない間は選べない。無反応だと壊れて見えるので、理由を言う。
    if (!imageEditing) {
      setStatus({ tone: "warn", text: "この画像はいま編集できないため、文字を選べません。右のパネルで理由を確認してください。" });
      return;
    }
    const item = pageItems[value.slotIndex];
    if (!item) return;
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
    pages: previewPages.map(value => ({
      id: value.id,
      // 表紙のジャケットは各メイン画像の作品。作品の未保存や編集中はそちらで言い、表紙は自分の背景色だけにする。
      itemIds: value.kind === "cover" ? [] : value.slots.map(slot => slot.id),
      bgColor: snapshot.document.pages.find(saved => saved.id === value.id)?.bgColor ?? null,
    })),
    isItemDirty: itemDirty,
    dirtyPageIds: new Set(dirtyPages.map(entry => entry.value.id)),
    // 自動で入れた仮の色は「背景未設定」のまま見せる。
    pageColors: Object.fromEntries(Object.entries(pageColors).filter(([id]) => !isAutoColor(id))),
    foreignLocks: heldElsewhere.map(lock => ({ ...lock, owner: memberName(lock.owner) })),
    heldLocks: Object.values(activeLocks),
  });

  function closeLoadMenu() {
    if (loadMenuRef.current) loadMenuRef.current.open = false;
  }

  function closeGuide() {
    setGuideOpen(false);
    try {
      window.localStorage.setItem(GUIDE_KEY, "closed");
    } catch {
      // 覚えられなくても、次に開いたときにまた案内が出るだけ。
    }
  }

  /** 「最新のバージョンを読み込む」。保存していない変更は捨てるので、あるときは先に確かめる。 */
  function requestReload() {
    if (unsavedLabels.length > 0) {
      setReloadPrompt(true);
      return;
    }
    void reload();
  }

  /** 自分の別の画面に残った並び順ロックを引き取って返す。残っている間は、どの画像も編集できないため。 */
  async function endStrayStructure() {
    const lock = await session.acquire("structure", documentId, "transfer");
    if (lock) {
      pendingRelease.current = session.release("structure", documentId);
      await pendingRelease.current;
    }
    setEditAttempt(null);
  }

  /** 見るだけの状態。なぜ触れないのかと、次にできることだけを出す。編集部品は出さない。 */
  function renderNotEditing() {
    const retry = (
      <SecondaryButton disabled={busy} onClick={() => setEditAttempt(null)} className="min-h-9 px-3 text-xs">もう一度試す</SecondaryButton>
    );
    let title: string, body: string, action: ReactNode = null;
    if (imageEditLost) {
      title = "編集できなくなりました";
      body = "通信が途切れたか、ほかの画面で編集を始めました。入力中の内容はこの画面に残っています。";
      action = (
        // 手放したのは自分のロックなので、DBに残っていれば引き継いで取り直す。ほかの人が持っていれば、その人の編集中として出る。
        // 押したときだけ呼ぶ（描画中には読まない）。
        // eslint-disable-next-line react-hooks/refs
        <PrimaryButton disabled={busy || !page} onClick={() => page && void beginImageEdit(page.id, "transfer")} className="min-h-9 px-3 text-xs">
          もう一度編集をはじめる
        </PrimaryButton>
      );
    } else if (attempt?.phase === "blocked" && blocker) {
      if (blocker.self && blocker.kind === "structure") {
        title = "自分の別の画面で並び順を変更中です";
        body = "並び順を変えている間は、どの画像も編集できません。別の画面を閉じるか、ここで並び順の編集を終わらせてください。";
        action = <PrimaryButton disabled={busy} onClick={() => void endStrayStructure()} className="min-h-9 px-3 text-xs">並び順の編集を終わらせる</PrimaryButton>;
      } else if (blocker.self) {
        title = "自分の別の画面でこの画像を編集中です";
        body = "別のタブや端末で開いたままになっています。この画面で続けると、別の画面の未保存の変更は保存できなくなります。";
        action = <PrimaryButton disabled={busy || !page} onClick={() => page && void beginImageEdit(page.id, "transfer")} className="min-h-9 px-3 text-xs">この画面で編集する</PrimaryButton>;
      } else if (blocker.kind === "structure") {
        title = `${memberName(blocker.owner)} が並び順を変更中です`;
        body = "並び順の変更が終わるまで、画像は編集できません。20秒ごとに確かめていて、終われば自動で編集できるようになります。";
        action = retry;
      } else {
        title = `${memberName(blocker.owner)} がこの画像を編集中です`;
        body = "プレビューで見ることはできます。20秒ごとに確かめていて、相手が別の画像へ移るか画面を閉じれば、自動で編集できるようになります。";
        action = retry;
      }
    } else if (attempt?.phase === "blocked") {
      title = "ほかの編集と重なりました";
      body = "少し待つと自動で取り直します。";
      action = retry;
    } else if (attempt?.phase === "failed") {
      title = "編集を始められませんでした";
      body = attempt.message || "通信を確認して、もう一度試してください。";
      action = retry;
    } else {
      title = `画像 ${pageNumber} を開いています…`;
      body = "編集の準備をしています。";
    }
    return (
      <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)" }}>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{body}</p>
        {action && <div className="pt-1">{action}</div>}
      </div>
    );
  }

  const unsavedPageNumbers = previewPages.filter(value => pageBadges[value.id]?.dirty).map(value => value.no);

  const navigator = (orientation: "vertical" | "horizontal") => (
    <PageNavigator
      documentId={documentId}
      pages={previewPages}
      pageIndex={currentIndex}
      onSelect={selectPage}
      onReorder={openReorder}
      reorderDirty={structureDirty}
      orientation={orientation}
      states={pageBadges}
    />
  );

  return (
    <GeneratorRuntimeProvider documentId={documentId} theme={snapshot.document.theme} period={snapshot.document.period}>
      <div className="generator-workspace relative left-1/2 w-[calc(100vw-2rem)] max-w-[100rem] -translate-x-1/2 space-y-4">
        {/* 企画名・保存状態・移動を1行に畳む。空けた縦はプレビューへ回す。 */}
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/generator" onClick={guardLink("/generator")} className="shrink-0 text-xs text-violet-300 hover:underline">← 企画一覧</Link>
            <h1 className="min-w-0 truncate text-base font-bold sm:text-lg">
              {seriesLabels[snapshot.document.series]} {periodLabel(snapshot.document)}
            </h1>
            {/* 文書全体の保存状態。件数ではなく「どの画像か」で言い、押せばその画像へ移る。 */}
            {unsavedLabels.length > 0
              ? (
                <span
                  className="inline-flex flex-wrap items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300"
                  title={`保存していない変更: ${unsavedLabels.join(" / ")}`}
                >
                  未保存：
                  {unsavedPageNumbers.map(no => (
                    <button
                      key={no}
                      type="button"
                      onClick={() => {
                        const index = previewPages.findIndex(value => value.no === no);
                        if (index >= 0) selectPage(index);
                      }}
                      className="underline decoration-dotted underline-offset-2 hover:text-amber-200"
                    >
                      画像 {no}
                    </button>
                  ))}
                  {structureDirty && <button type="button" onClick={openReorder} className="underline decoration-dotted underline-offset-2 hover:text-amber-200">並び順</button>}
                  {unsavedPageNumbers.length === 0 && !structureDirty && <span>{unsavedLabels.length}件</span>}
                </span>
              )
              : <Chip tone="success">すべて保存済み</Chip>}
          </div>
          {/* shrink-0 にすると、狭い画面でボタンが画面外へはみ出して押せなくなる。 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* 別画面へ移るだけのものは控えめな文字リンクにする。主操作は書き出しだけ。 */}
            <Link
              href={`/generator/${documentId}/settings`}
              onClick={guardLink(`/generator/${documentId}/settings`)}
              className="text-xs hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              共通設定
            </Link>
            <Link
              href={`/generator/${documentId}/history`}
              onClick={guardLink(`/generator/${documentId}/history`)}
              className="text-xs hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              変更履歴
            </Link>
            {!guideOpen && (
              <button type="button" onClick={() => setGuideOpen(true)} className="text-xs hover:underline" style={{ color: "var(--text-secondary)" }}>
                使い方
              </button>
            )}
            {/*
              読み直しは2つ。読む先が違うので1つの操作にはまとめない（引き継ぎの不変条件）。
              どちらも頻度が低いので、1つのメニューへ畳み、それぞれに何が起きるかを添える。
            */}
            <details ref={loadMenuRef} className="relative">
              <summary
                className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-xl border px-3 text-xs hover:bg-white/5 [&::-webkit-details-marker]:hidden"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                読み込み ▾
              </summary>
              <div
                className="absolute right-0 z-40 mt-1 w-72 space-y-1 rounded-xl border p-2 shadow-xl"
                style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-card)" }}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { closeLoadMenu(); requestReload(); }}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/5 disabled:opacity-40"
                >
                  <span className="block text-xs font-semibold">最新のバージョンを読み込む</span>
                  <span className="mt-0.5 block text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
                    ほかの人が保存した内容を読み込みます。保存していない変更は捨てられます。
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { closeLoadMenu(); void openSourceUpdate(); }}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/5 disabled:opacity-40"
                >
                  <span className="block text-xs font-semibold">Release Masterから取り込み直す</span>
                  <span className="mt-0.5 block text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
                    スプレッドシート側の作品の増減や文字の変更を確認して、選んだものだけ取り込みます。
                  </span>
                </button>
              </div>
            </details>
            {/* 全ページのPNGは文書単位の操作なので、ページごとの書き出しとは分けてここに置く。 */}
            <BulkExportButton document={previewDocument} pages={previewPages} canExport={unsavedLabels.length === 0} onStatus={setStatus} />
          </div>
        </header>

        {guideOpen && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border-accent)", backgroundColor: "rgba(139,92,246,.07)" }}>
            <span className="font-semibold" style={{ color: "#c4b5fd" }}>使い方</span>
            <span>① 画像を選んで確認・修正</span>
            <span style={{ color: "var(--text-secondary)" }}>→</span>
            <span>② 画像ごとに「保存」</span>
            <span style={{ color: "var(--text-secondary)" }}>→</span>
            <span>③ 「全ページを書き出す」</span>
            <span className="flex-1" />
            <button type="button" onClick={closeGuide} className="rounded border px-2 py-0.5" style={{ borderColor: "var(--border-subtle)" }}>閉じる</button>
          </div>
        )}

        {previewPage && (
          <CoverColorProbe
            documentId={documentId}
            pageId={previewPage.id}
            source={colorSource}
            known={Boolean(colorCandidates[previewPage.id])}
            onColors={rememberColors}
          />
        )}

        {sourceUpdate && (
          <SourceUpdateDialog
            document={snapshot.document}
            diff={sourceUpdate.diff}
            refresh={sourceUpdate.refresh}
            refreshError={sourceUpdate.refreshError}
            unsavedItemIds={snapshot.document.items.filter(item => itemDirty(item.id)).map(item => item.id)}
            disabled={busy}
            onApply={value => void applySourceUpdate(value)}
            onClose={() => void closeSourceUpdate()}
          />
        )}

        {/*
          上部の帯は「操作の結果」だけを出す場所（2026-09-18）。成功は数秒で消え、警告とエラーは残る。
          ほかの人の編集中はサムネイルと編集パネルで、取り込んだ内容は作品の欄で言う。
          このブラウザの一時保存は、保存済みと違う内容が残っているときだけ出す。
        */}
        {recoveryOffer && (
          <StatusBanner
            tone="warn"
            dense
            actions={
              <span className="flex gap-2">
                <button type="button" onClick={restoreRecovery} className="rounded border px-2 py-0.5" style={{ borderColor: "var(--border-subtle)" }}>開く</button>
                <button type="button" onClick={discardRecovery} className="rounded border px-2 py-0.5" style={{ borderColor: "var(--border-subtle)" }}>捨てる</button>
              </span>
            }
          >
            前回、保存していない変更がこのブラウザに残っています。
          </StatusBanner>
        )}
        {status.text && (
          <StatusBanner tone={status.tone} dense>
            {status.text}
          </StatusBanner>
        )}
        {recoveryFailed && (
          <StatusBanner tone="warn" dense>
            このブラウザに一時保存できていません（容量不足など）。画面を閉じる前に「保存」してください。
          </StatusBanner>
        )}

        {!wide && <div className="xl:hidden">{navigator("horizontal")}</div>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:h-[calc(100vh-13rem)] xl:grid-cols-[8.5rem_minmax(0,1fr)_26rem] xl:items-stretch">
          <aside className="hidden xl:block xl:h-full xl:min-h-0">
            {wide && navigator("vertical")}
          </aside>

          {/* 行送りを触っている間もプレビューが見えているように、画面上部へ留める。 */}
          <Panel padding="tight" className="sticky top-16 z-20 xl:static xl:h-full xl:min-h-0 xl:overflow-y-auto">
            {/* プレビューの h-full は広い画面の3カラムでだけ効かせる。狭い画面で効くと、下の編集中の帯がパネルからはみ出す。 */}
            <div className="xl:h-full xl:min-h-0">
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
                canExport={unsavedLabels.length === 0}
                blockedReasons={unsavedLabels}
              />
            ) : (
              <p className="text-sm text-amber-300">表示できる画像がありません。</p>
            )}
            </div>
          </Panel>

          {/*
            編集パネルは1枚（2026-09-18、利用者の決定でタブをやめた）：見出し → 背景色 → 文字 → 下端の保存の帯。
            切り替えが無いので「押せば切り替わる」ことに気づけない問題が起きない。
            保存の帯は下端に固定し、欄をスクロールしても見えたままにする（3カラムではパネルの下端、狭い画面では画面の下端）。
          */}
          {/* overflow-hidden を付けない。付けると下端の帯がパネルの中に貼りつき、画面の外へ出てしまう。スクロールは中身の列が持つ。 */}
          <Panel padding="none" className="flex flex-col xl:h-full xl:min-h-0">
            <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-3" style={{ borderColor: "var(--border-subtle)" }}>
              <h2 className="text-sm font-semibold">画像 {pageNumber}</h2>
              {previewPage && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{pageKindLabel(previewPage.kind)}</span>}
              <span className="flex-1" />
              {imageEditing
                ? <span className="text-[11px] text-emerald-300">● 編集中</span>
                : imageEditLost || attempt?.phase === "blocked" || attempt?.phase === "failed"
                  ? <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>🔒 編集できません</span>
                  : <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>準備中…</span>}
            </div>

            <div className="space-y-5 px-4 py-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              {!imageEditing ? renderNotEditing() : (
                <>
                  {savedPage && (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                        背景色<span className="ml-1 font-normal">（この画像だけ）</span>
                        {pageDirty && <span className="ml-1.5 font-normal text-amber-300">・変更あり</span>}
                      </h3>
                      <PageInspector
                        state={pageTargetStateFor(savedPage.id)}
                        color={pageColors[savedPage.id] ?? savedPage.bgColor ?? FALLBACK_PAGE_COLOR}
                        // 自動で入れた仮の色は「決まった色」として扱わない。保存するか選び直すよう促す。
                        defined={Boolean(savedPage.bgColor) || (pageColors[savedPage.id] !== undefined && !isAutoColor(savedPage.id))}
                        candidates={colorCandidates[savedPage.id] || []}
                        onColor={value => setPageColors(current => ({ ...current, [savedPage.id]: value }))}
                      />
                    </section>
                  )}

                  {activeItem && page && (page.kind === "adopted" || page.kind === "listed" || page.kind === "feature" || page.kind === "others") && (
                    <section className="space-y-2 border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
                      <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>文字</h3>
                      {page.kind === "others" && pageItems.length > 1 ? (
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
                      ) : pageItems.length > 1 ? (
                        <SegmentedControl
                          label="掲載の位置"
                          size="small"
                          value={String(Math.min(slotIndex, pageItems.length - 1))}
                          onChange={next => setSlotIndex(Number(next))}
                          options={pageItems.map((item, index) => ({
                            value: String(index),
                            label: index === 0 ? "上段の作品" : "下段の作品",
                            dot: itemDirty(item.id) ? "warn" : undefined,
                          }))}
                        />
                      ) : null}
                      <ItemInspector
                        key={`${activeItem.id}:${snapshot.itemVersions[activeItem.id]}:${inspectorEpoch}`}
                        item={activeItem}
                        draft={drafts[activeItem.id]}
                        pageKind={page.kind}
                        diagnostic={bodyDiagnostic.find(value => value.slotId === activeItem.id) || null}
                        jacketMissing={Boolean(diagnostics && previewPage && diagnostics.pageId === previewPage.id
                          && diagnostics.missingJackets.includes(activeItem.id))}
                        state={itemTargetStateFor(activeItem.id)}
                        onDraft={content => setDrafts(current => ({ ...current, [activeItem.id]: content }))}
                        onImage={file => session.uploadImage("item", activeItem.id, file)}
                        onImageUrl={url => session.uploadImageUrl(activeItem.id, url)}
                        selection={selection}
                        onSelection={next => setSelectionState({ ...next, itemId: activeItem.id, slotIndex: Math.min(slotIndex, Math.max(0, pageItems.length - 1)) })}
                        allowTracking={!phone}
                        pendingSource={Boolean(pendingSources[activeItem.id])}
                        onCancelSource={() => {
                          const id = activeItem.id;
                          setPendingSources(current => {
                            const next = { ...current };
                            delete next[id];
                            return next;
                          });
                          setStatus({ tone: "info", text: "Release Masterから取り込んだ情報を取り消しました。直した文字はそのままです。" });
                        }}
                      />
                    </section>
                  )}
                </>
              )}
            </div>

            {imageEditing && (
              <div
                // 3カラムでも、上の案内や知らせの帯でページ自体が縦に伸びることがある。どの幅でも画面の下端に貼りつける。
                className="sticky bottom-0 z-10 shrink-0 rounded-b-2xl border-t"
                style={{ borderColor: imageDirty ? "rgba(245,158,11,.5)" : "var(--border-subtle)", backgroundColor: "var(--bg-card)" }}
              >
                <div
                  className="flex flex-wrap items-center gap-2 rounded-b-2xl px-4 py-2.5 text-xs"
                  style={{ backgroundColor: imageDirty || imageAutoColorOnly ? "rgba(245,158,11,.12)" : "transparent" }}
                >
                  {saving ? (
                    <span style={{ color: "var(--text-secondary)" }}>保存しています…</span>
                  ) : imageDirty ? (
                    <span className="font-semibold text-amber-300">未保存の変更 {imageChanges.length}件</span>
                  ) : imageAutoColorOnly ? (
                    <span className="text-amber-300">背景色が仮の色です</span>
                  ) : (
                    <span style={{ color: "var(--text-secondary)" }}>
                      {imageSaved
                        ? `すべて保存済み · ${savedAtFormat.format(new Date(imageSaved.createdAt))} ${memberName(imageSaved.actor)}`
                        : "まだ一度も保存されていません"}
                    </span>
                  )}
                  <span className="flex-1" />
                  {/* 変更が無いときは押せないボタンを並べない。以前の保存へ戻す入口だけを控えめに出す。 */}
                  {!imageDirty && !saving && (
                    <details className="relative">
                      <summary className="cursor-pointer list-none text-[11px] underline decoration-dotted underline-offset-2 [&::-webkit-details-marker]:hidden" style={{ color: "var(--text-secondary)" }}>
                        以前の保存に戻す
                      </summary>
                      <div
                        className="absolute bottom-full right-0 z-40 mb-2 w-80 max-w-[calc(100vw-3rem)] space-y-3 rounded-xl border p-3 shadow-xl"
                        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-card)" }}
                      >
                        {activeItem && <RestoreControl state={itemTargetStateFor(activeItem.id)} bare />}
                        {savedPage && <RestoreControl state={pageTargetStateFor(savedPage.id)} bare />}
                      </div>
                    </details>
                  )}
                  {imageDirty && (
                    <SecondaryButton disabled={busy} onClick={() => setDiscardPrompt(true)} className="!min-h-9 px-3 text-xs">破棄</SecondaryButton>
                  )}
                  {(imageDirty || imageAutoColorOnly) && (
                    <PrimaryButton disabled={busy || !imageSavable} onClick={() => void saveImage()} className="!min-h-9 px-4 text-xs">保存</PrimaryButton>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </div>

        {reorderOpen && (
          <StructureDialog
            state={{
              ...targetState(
                "structure",
                documentId,
                structureDirty,
                // 呼ばれるのはダイアログの効果（開いたとき）と再試行ボタンだけで、描画中には読まない。
                // eslint-disable-next-line react-hooks/refs
                () => void beginStructureEdit(),
                () => void saveSingle("structure", documentId, {
                  pages: (structurePages || snapshot.document.pages).map(value => ({ id: value.id, itemIds: value.itemIds })),
                }),
              ),
              // 開いたら、そのまま並び替えられる。画像の編集と同じく、開始ボタンを挟まない。
              direct: true,
            }}
            notice={structureNotice}
            pages={visiblePages}
            items={items}
            onPages={setStructurePages}
            onClose={requestCloseReorder}
          />
        )}

        {leavePrompt && page && (
          <Modal title="編集内容を保存しますか？" description={`画像 ${pageNumber} に、保存していない変更があります。`} onClose={() => setLeavePrompt(null)}>
            <ul className="space-y-1 text-sm">
              {imageChanges.map(change => <li key={`${change.kind}:${change.targetId}`}>・{change.label}</li>)}
            </ul>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <SecondaryButton disabled={busy} onClick={discardAndLeave} className="min-h-11 px-4 text-sm">変更を破棄</SecondaryButton>
              <PrimaryButton disabled={busy} onClick={() => void saveAndLeave()} className="min-h-11 px-4 text-sm">保存</PrimaryButton>
            </div>
          </Modal>
        )}

        {discardPrompt && page && (
          <Modal title="変更を破棄しますか？" description={`画像 ${pageNumber} の保存していない変更を捨てて、保存済みの内容へ戻します。`} onClose={() => setDiscardPrompt(false)}>
            <ul className="space-y-1 text-sm">
              {imageChanges.map(change => <li key={`${change.kind}:${change.targetId}`}>・{change.label}</li>)}
            </ul>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <SecondaryButton onClick={() => setDiscardPrompt(false)} className="min-h-11 px-4 text-sm">戻る</SecondaryButton>
              <PrimaryButton onClick={discardCurrent} className="min-h-11 px-4 text-sm">変更を破棄</PrimaryButton>
            </div>
          </Modal>
        )}

        {reloadPrompt && (
          <Modal
            title="保存していない変更があります"
            description="最新のバージョンを読み込むと、この画面で保存していない変更は捨てられます。"
            onClose={() => setReloadPrompt(false)}
          >
            <ul className="space-y-1 text-sm">
              {unsavedLabels.map(label => <li key={label}>・{label}</li>)}
            </ul>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <SecondaryButton onClick={() => setReloadPrompt(false)} className="min-h-11 px-4 text-sm">やめる</SecondaryButton>
              <PrimaryButton onClick={() => { setReloadPrompt(false); void reload(); }} className="min-h-11 px-4 text-sm">変更を捨てて読み込む</PrimaryButton>
            </div>
          </Modal>
        )}

        {structurePrompt && (
          <Modal title="並び順を保存しますか？" description="並び順に、保存していない変更があります。" onClose={() => setStructurePrompt(false)}>
            <div className="flex flex-wrap justify-end gap-2">
              <SecondaryButton disabled={busy} onClick={() => closeReorder(true)} className="min-h-11 px-4 text-sm">変更を破棄</SecondaryButton>
              <PrimaryButton disabled={busy} onClick={() => void saveStructureAndClose()} className="min-h-11 px-4 text-sm">保存</PrimaryButton>
            </div>
          </Modal>
        )}
      </div>
    </GeneratorRuntimeProvider>
  );

  /** 作品・背景の状態は画像の操作列がまとめて出すので、ここでは復元と入力欄の可否にだけ使う。 */
  function itemTargetStateFor(itemId: string): TargetState {
    return targetState("item", itemId, itemDirty(itemId), () => setEditAttempt(null), () => void saveImage());
  }

  function pageTargetStateFor(pageId: string): TargetState {
    return targetState("page", pageId, pageDirty, () => setEditAttempt(null), () => void saveImage());
  }
}
