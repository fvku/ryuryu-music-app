/**
 * 波の素材は月替わりで、Koheiが月ごとに原版を渡す（docs/generator-weekly-design.md §6.5・§9-3）。
 * どの月の波を使うか、対象月が未登録のときにどうするかだけをここに置く。
 *
 * 画像そのもの（`BUNDLED_WAVES`）は`runtime.tsx`にある。ここは**画像を持たない純粋なロジック**にして、
 * 境界の挙動を自動テストで固定できるようにしてある。
 */

/** "2026-09" → "2026年9月" */
export function waveMonthLabel(month: string): string {
  const [year, mm] = month.split("-");
  return `${year}年${Number(mm)}月`;
}

export type WaveChoice = {
  /** 実際に使う波の月。 */
  month: string;
  /** 本来使うべき月（文書の対象月）。 */
  requested: string;
  /** 対象月の波がそろっていたか。 */
  exact: boolean;
};

/**
 * 対象月の波を選ぶ。無ければ**直近の登録済みの月**を代わりに使い、`exact: false`で呼び出し側に知らせる。
 * 対象月が登録済みのどれよりも前なら、いちばん古い月を使う。
 */
export function pickWaveMonth(available: readonly string[], requested: string): WaveChoice {
  if (available.includes(requested)) return { month: requested, requested, exact: true };
  const months = [...available].sort();
  if (!months.length) return { month: requested, requested, exact: false };
  const before = months.filter(month => month <= requested);
  return { month: before.length ? before[before.length - 1] : months[0], requested, exact: false };
}

/**
 * 対象月の波が無いまま描いているときの警告。
 *
 * **別の月の波で描いた画像は見た目が破綻しないので、言われないと気づけない。** この企画では
 * 「おかしい状態のままPNGを作らせない」のが既定の扱い（作品名のはみ出し、行数超過など）なので、
 * ここも同じ扱いにする。プレビューの警告欄と一括書き出しのゲートの両方がこれを使う。
 */
export function waveMonthWarning(wave: WaveChoice | null | undefined): string[] {
  if (!wave || wave.exact) return [];
  return [`${waveMonthLabel(wave.requested)}の波がまだ登録されていません（いまは${waveMonthLabel(wave.month)}の波で描いています）。その月の原版を受け取って登録するまで書き出せません。`];
}
