/**
 * 書きかけの原稿（レビュー・M/J文章）の復旧用コピー。
 * 端末のlocalStorageにだけ置く。保存に成功したら消す。
 * 誤タップ・再読み込み・タブの破棄で入力が消えても、次に開いたときに戻せるようにする。
 */

const PREFIX = "ryuryu_draft:";
/** これより古い下書きは復元を提案しない（別の作業の残骸を出さないため） */
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface StoredDraft<T> {
  savedAt: number;
  value: T;
}

export type DraftKind = "review" | "mj";

/** アルバムはUID優先、なければNo.で識別する。レビューは本人ごとに分ける */
export function draftKey(kind: DraftKind, album: { uid?: string; no: string }, owner = ""): string {
  const id = album.uid?.trim() || `no-${album.no}`;
  return `${PREFIX}${kind}:${id}${owner ? `:${owner.toLowerCase()}` : ""}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft<T>(key: string, now = Date.now()): StoredDraft<T> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.savedAt !== "number" || parsed.value === undefined) return null;
    if (now - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      s.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T, now = Date.now()): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify({ savedAt: now, value } satisfies StoredDraft<T>));
  } catch {
    // 容量超過・プライベートモードでは復旧コピーを諦める（入力自体は画面に残る）
  }
}

export function clearDraft(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // 何もしない
  }
}
