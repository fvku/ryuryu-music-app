/**
 * APIルート用の in-memory キャッシュ。
 *
 * Google Sheets の全読みを伴う GET ルートの結果を TTL 付きで保持し、
 * 書き込みルートからの明示的な無効化（invalidateCache）で
 * 同一インスタンス内の読み書き一貫性を保つ。
 *
 * 制約: Vercel のインスタンスごとに独立したキャッシュなので、
 * 別インスタンスに当たった場合は最大 TTL ぶん古い結果が返りうる。
 * TTL はそれを許容できる長さに抑えること。
 */

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export const CACHE_KEY = {
  RELEASE_MASTER: "release-master",
  SCORES: "scores",
  SETTINGS: "settings",
  NOTIFICATION_SEEN: "notification-seen",
} as const;

export const CACHE_TTL = {
  RELEASE_MASTER: 60 * 1000,      // 60秒
  SCORES: 60 * 1000,              // 60秒
  SETTINGS: 5 * 60 * 1000,        // 5分
  NOTIFICATION_SEEN: 30 * 1000,   // 30秒
} as const;

/**
 * key のキャッシュがあれば返し、なければ fetcher を実行して保存する。
 * 同一 key の並行リクエストは 1 回の fetcher 実行に合流させる。
 */
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = fetcher()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** 書き込み後に呼び、該当キャッシュを破棄する */
export function invalidateCache(...keys: string[]) {
  for (const k of keys) store.delete(k);
}
