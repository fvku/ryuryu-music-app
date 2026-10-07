export function rebaseKerns(oldText: string, newText: string, kerns: Record<string, number>): Record<string, number> {
  let start = 0;
  let oldEnd = oldText.length;
  let newEnd = newText.length;

  while (start < oldEnd && start < newEnd && oldText[start] === newText[start]) start += 1;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const shift = newEnd - start - (oldEnd - start);
  const result: Record<string, number> = {};
  for (const [raw, value] of Object.entries(kerns)) {
    const index = Number(raw);
    if (index < start) result[index] = value;
    else if (index >= oldEnd && index + shift < newText.length) result[index + shift] = value;
  }
  return result;
}

export function selectedSpacing(
  text: string,
  tracking: number,
  kerns: Record<string, number>,
  start: number,
  end: number,
): number | null {
  if (end <= start) return tracking;
  let result: number | undefined;
  for (let index = start; index < end; index += 1) {
    if (text[index] === "\n") continue;
    const current = Number((tracking + (kerns[index] || 0)).toFixed(6));
    if (result !== undefined && result !== current) return null;
    result = current;
  }
  return result ?? tracking;
}

export function applySelectedSpacing(
  text: string,
  tracking: number,
  kerns: Record<string, number>,
  start: number,
  end: number,
  next: number,
): { tracking: number; kerns: Record<string, number> } {
  if (end <= start) return { tracking: next, kerns: {} };
  const result = { ...kerns };
  const delta = Number((next - tracking).toFixed(6));
  for (let index = start; index < end; index += 1) {
    if (text[index] === "\n") continue;
    if (delta === 0) delete result[index];
    else result[index] = delta;
  }
  return { tracking, kerns: result };
}

export type LaidOutLine = { start: number; end: number; clusters: { at: number; text: string }[] };
type Spacing = { tracking: number; kerns: Record<string, number> };

/**
 * 選択範囲の字間を変えても、範囲より前の行の折り返しを変えない（2026-10-07、利用者の要望）。
 *
 * 折り返しは先頭から詰めていく方式なので、行頭の文字（欧文は単語ひとかたまり）を詰めると
 * 前の行の末尾へ収まるようになり、前の行が変わって語が割れる。そうなるときだけ、
 * 行頭のかたまりのうち選択範囲に入っている文字の字間を「前の行へ上がらない最小の値」にとどめる。
 * ほかの文字は指定どおり。とどめた文字は`held`で返し、画面で知らせる。
 *
 * `layout`は描画と同じ折り返し（`Render.bodyLines`）。行の範囲とかたまりの位置だけを使う。
 */
export function keepEarlierLines(
  before: Spacing,
  after: Spacing,
  start: number,
  end: number,
  layout: (spacing: Spacing) => LaidOutLine[],
): Spacing & { held: { start: number; end: number; value: number } | null } {
  const unchanged = { ...after, held: null };
  const lines = layout(before);
  const lineIndex = lines.findIndex(line => start >= line.start && start < line.end);
  if (lineIndex <= 0) return unchanged;
  const earlier = (spacing: Spacing) => {
    const next = layout(spacing);
    return lines.slice(0, lineIndex).every((line, index) => next[index]?.start === line.start && next[index]?.end === line.end);
  };
  if (earlier(after)) return unchanged;

  const first = lines[lineIndex].clusters[0];
  if (!first) return unchanged;
  const from = Math.max(first.at, start), to = Math.min(first.at + first.text.length, end);
  if (to <= from) return unchanged;

  const withValue = (value: number): Spacing => {
    const kerns = { ...after.kerns };
    const delta = Number((value - after.tracking).toFixed(6));
    for (let index = from; index < to; index += 1) {
      if (delta === 0) delete kerns[index]; else kerns[index] = delta;
    }
    return { tracking: after.tracking, kerns };
  };
  // 指定値（low）では上がる。元の値なら上がらないので、その手前で最も指定値に近い値を二分探索する。
  // 元の値が文字ごとに違うときは、そのうち最も広い値を上限にする（そこまで広げれば必ず上がらない）。
  let low = Number((after.tracking + (after.kerns[from] || 0)).toFixed(6));
  let high = low;
  for (let index = from; index < to; index += 1) high = Math.max(high, before.tracking + (before.kerns[index] || 0));
  if (high <= low || !earlier(withValue(high))) return unchanged;
  for (let step = 0; step < 20; step += 1) {
    const middle = (low + high) / 2;
    if (earlier(withValue(middle))) high = middle; else low = middle;
  }
  // 保存は%小数1桁（em小数3桁）なので、上がらない側へ切り上げる。
  let value = Math.ceil(high * 1000 - 1e-6) / 1000;
  if (!earlier(withValue(value))) value = high;
  return { ...withValue(value), held: { start: from, end: to, value } };
}
