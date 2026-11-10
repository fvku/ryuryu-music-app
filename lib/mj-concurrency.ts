/**
 * M/J執筆モーダルの保存で、他の人の保存を上書きしないための判定。
 *
 * 画面を開いた時点の値（base）と、いま送る値（next）を比べ、変えた項目だけを送る。
 * サーバーは送られた項目ごとに「シートの現在値が base のままか」を確かめ、
 * 他の人がその間に書き換えていたら書き込まずに 409 を返す。
 * 変えていない項目は送らないので、他の人が直した国やジャンルを古い値で戻すこともない。
 */

export const MJ_FIELDS = ["mjTrackNo", "mjTrack", "mjStartTime", "mjText", "genreMemo", "country"] as const;
export type MjField = (typeof MJ_FIELDS)[number];
export type MjValues = Partial<Record<MjField, string>>;

export const MJ_FIELD_LABEL: Record<MjField, string> = {
  mjTrackNo: "おすすめ曲の番号",
  mjTrack: "おすすめ曲",
  mjStartTime: "再生開始位置",
  mjText: "M/J文章",
  genreMemo: "ジャンル",
  country: "国",
};

export interface MjConflict {
  field: MjField;
  /** シートにいま入っている値（他の人が保存した値） */
  current: string;
}

const norm = (v: string | undefined | null) => (v ?? "").trim();

/** base から変わった項目だけを返す（前後の空白だけの違いは変更とみなさない） */
export function changedMjFields(base: MjValues, next: MjValues): MjValues {
  const out: MjValues = {};
  for (const f of MJ_FIELDS) {
    if (next[f] === undefined) continue;
    if (norm(next[f]) !== norm(base[f])) out[f] = norm(next[f]);
  }
  return out;
}

/**
 * 送られた項目のうち、開いた後に他の人が書き換えたものを返す。
 * 他の人の値が自分の送る値と同じなら衝突ではない（結果が同じなので）。
 * base に無い項目は照合できないので衝突扱いにしない（旧クライアント互換）。
 */
export function findMjConflicts(changes: MjValues, base: MjValues, current: MjValues): MjConflict[] {
  const conflicts: MjConflict[] = [];
  for (const f of MJ_FIELDS) {
    if (changes[f] === undefined || base[f] === undefined) continue;
    const cur = norm(current[f]);
    if (cur !== norm(base[f]) && cur !== norm(changes[f])) conflicts.push({ field: f, current: cur });
  }
  return conflicts;
}
