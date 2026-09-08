import type { PageBadges } from "../PageNavigator";
import type { FieldKey } from "../hit-test";
import type { GeneratorPage, ItemContent } from "@/lib/generator/model";

export type LockKind = "item" | "page" | "theme" | "structure";
export type ActiveLock = { kind: LockKind; targetId: string; clientId: string; token: string; generation: number; expiresAt: string };
export type LockResponse = { generation: number; expiresAt: string; owner: string };

export const targetLabels: Record<LockKind, string> = { item: "作品", page: "背景", theme: "共通設定", structure: "並び順" };

export function keyOf(kind: LockKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

export function lockPayload(lock: ActiveLock) {
  return { kind: lock.kind, targetId: lock.targetId, clientId: lock.clientId, token: lock.token, generation: lock.generation };
}

export function lockToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

export function cloneContent(content: ItemContent): ItemContent {
  return structuredClone(content);
}

export function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type OrderedPageKind = "adopted" | "listed" | "feature" | "others";

/** ページごとの件数を変えず、同じ区分内で作品を前後へ動かす。 */
export function movePageItem(pages: GeneratorPage[], kind: OrderedPageKind, itemId: string, delta: number): GeneratorPage[] {
  const groupPages = pages.filter(page => page.kind === kind), ordered = groupPages.flatMap(page => page.itemIds);
  const index = ordered.indexOf(itemId), target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return pages;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  let offset = 0;
  const replacements = new Map(groupPages.map(page => {
    const ids = ordered.slice(offset, offset + page.itemIds.length);
    offset += page.itemIds.length;
    return [page.id, ids];
  }));
  return pages.map(page => replacements.has(page.id) ? { ...page, itemIds: replacements.get(page.id)! } : page);
}

/** Weeklyのメイン1枠とOthersの1件をswapし、DB契約の「各ページの件数不変」を守る。 */
export function swapWeeklyFeatureItem(pages: GeneratorPage[], featureId: string, otherId: string): GeneratorPage[] {
  if (featureId === otherId) return pages;
  const featurePage = pages.find(page => page.kind === "feature" && page.itemIds[0] === featureId);
  const othersPage = pages.find(page => page.kind === "others" && page.itemIds.includes(otherId));
  if (!featurePage || !othersPage) return pages;
  return pages.map(page => {
    if (page.id === featurePage.id) return { ...page, itemIds: [otherId] };
    if (page.id === othersPage.id) return { ...page, itemIds: page.itemIds.map(id => id === otherId ? featureId : id) };
    return page;
  });
}

/**
 * 調整対象と選択範囲。`source` は「どこで選ばれたか」。
 * - `preview`：マウス・ペンでプレビューから選ばれた。入力欄を開き、フォーカスまで移す。
 * - `previewTouch`：タッチでプレビューから選ばれた。入力欄は開くがフォーカスは移さない（キーボードを出さない）。
 * - `previewOpen`：プレビュー由来で開いた欄の中で、利用者が選び直した。開いたままにするがフォーカスは触らない。
 * - `field`：入力欄や一覧から選ばれた。プレビュー由来の欄は閉じる。
 */
export type FieldSelection = {
  itemId: string;
  slotIndex: number;
  key: FieldKey;
  start: number;
  end: number;
  source: "preview" | "previewTouch" | "previewOpen" | "field";
};

/**
 * 画像ごとの状態。文書全体の「未保存◯件」だけでは、どの画像のことかがサムネイルから分からない。
 * 画面から切り離してテストできるよう、純粋な導出にしてある。
 */
export function derivePageBadges({
  pages,
  isItemDirty,
  dirtyPageIds,
  pageColors,
  foreignLocks,
}: {
  pages: { id: string; itemIds: string[]; bgColor?: string | null }[];
  isItemDirty(itemId: string): boolean;
  /** 背景色が未保存のページ。 */
  dirtyPageIds: ReadonlySet<string>;
  /** 編集中の背景色。保存済みの値より優先する。 */
  pageColors: Record<string, string>;
  /** この端末が持っていないロック。 */
  foreignLocks: { kind: string; targetId: string; owner: string }[];
}): Record<string, PageBadges> {
  const result: Record<string, PageBadges> = {};
  for (const page of pages) {
    const foreign = foreignLocks.find(lock => (lock.kind === "page" && lock.targetId === page.id)
      || (lock.kind === "item" && page.itemIds.includes(lock.targetId)));
    result[page.id] = {
      dirty: dirtyPageIds.has(page.id) || page.itemIds.some(id => isItemDirty(id)),
      lockedBy: foreign ? foreign.owner : null,
      needsColor: !(pageColors[page.id] ?? page.bgColor),
    };
  }
  return result;
}
