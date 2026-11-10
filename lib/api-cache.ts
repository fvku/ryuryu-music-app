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
const inflight = new Map<string, { generation: number; promise: Promise<unknown> }>();
/**
 * key ごとの世代。invalidateCache のたびに進める。
 * 読み取りの途中で無効化された場合、その読み取りは無効化より前の内容かもしれないので保存しない
 * （以前は、無効化の直後に古い読み取りが完了して旧データを再保存し、TTLのあいだ返し続けていた）。
 */
const generations = new Map<string, number>();
const generationOf = (key: string) => generations.get(key) ?? 0;

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
 * 同一 key・同一世代の並行リクエストは 1 回の fetcher 実行に合流させる。
 */
export async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value as T;

  const generation = generationOf(key);
  const pending = inflight.get(key);
  if (pending && pending.generation === generation) return pending.promise as Promise<T>;

  const p = fetcher()
    .then((value) => {
      if (generationOf(key) === generation) store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      if (inflight.get(key)?.promise === p) inflight.delete(key);
    });
  inflight.set(key, { generation, promise: p });
  return p;
}

/** 書き込み後に呼び、該当キャッシュを破棄する。実行中の読み取りにも合流させない */
export function invalidateCache(...keys: string[]) {
  for (const k of keys) {
    store.delete(k);
    inflight.delete(k);
    generations.set(k, generationOf(k) + 1);
  }
}
