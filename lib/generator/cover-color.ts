/**
 * カバージャケットから背景色の候補を出す。
 *
 * 背景は「色の面 ＋ 波（Luminosity・不透明度50%）」の合成で、白文字を載せる前提の版面。
 * 合成は色相と彩度を保つので、拾った色相はそのまま残し、明るすぎ・暗すぎ・鮮やかすぎだけを
 * 実物の投稿で測った範囲へ寄せる。ここで返すのは**初期値と候補**であり、最終的には人が決める。
 *
 * 実測（`tools/generator-lab/reference` の投稿7枚、2026-09-12）では、合成後の背景は
 * 彩度12〜33%・明度55〜78%に収まっていた。合成で明度が波へ引かれるぶんを見込んで、
 * 色の面そのものは彩度25〜60%・明度45〜75%へ収める。
 *
 * 同じ実測で、人が選んだ色の色相がジャケットの主要色と160°以上離れている画像が7枚中3枚あった。
 * 主要色ひとつに決め打ちせず、候補を複数返すのはこのため。
 */
export type CoverColor = { hex: string; share: number };

const SATURATION = { min: 0.25, max: 0.6 };
const VALUE = { min: 0.45, max: 0.75 };

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = (mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4)) * 60;
  return { h, s: mx ? d / mx : 0, v: mx };
}

export function hsvToHex({ h, s, v }: { h: number; s: number; v: number }): string {
  const hue = ((h % 360) + 360) % 360, c = v * s, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map(value => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("");
}

/** 背景として使える範囲へ寄せる。色相は動かさない。 */
export function fitForBackground(r: number, g: number, b: number): string {
  const { h, s, v } = rgbToHsv(r, g, b);
  return hsvToHex({ h, s: clamp(s || SATURATION.min, SATURATION.min, SATURATION.max), v: clamp(v, VALUE.min, VALUE.max) });
}

/**
 * RGBA画素列から候補を出す。面積の大きい順。
 * 無彩色・白飛び・黒潰れは候補から外し、色が1つも残らないときだけ全体の平均から1つ作る。
 */
export function coverColorCandidates(pixels: ArrayLike<number>, limit = 4): CoverColor[] {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  let total = 0, sumR = 0, sumG = 0, sumB = 0, counted = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    counted++; sumR += r; sumG += g; sumB += b;
    const { h, s, v } = rgbToHsv(r, g, b);
    if (s < 0.18 || v < 0.12 || v > 0.95) continue;
    const key = `${Math.round(h / 20)}:${Math.round(s * 4)}:${Math.round(v * 4)}`;
    const entry = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    entry.n++; entry.r += r; entry.g += g; entry.b += b;
    buckets.set(key, entry);
    total++;
  }
  if (!counted) return [];
  if (!total) return [{ hex: fitForBackground(sumR / counted, sumG / counted, sumB / counted), share: 1 }];
  const result: CoverColor[] = [];
  for (const entry of [...buckets.values()].sort((left, right) => right.n - left.n)) {
    const hex = fitForBackground(entry.r / entry.n, entry.g / entry.n, entry.b / entry.n);
    if (result.some(value => value.hex === hex)) continue;
    result.push({ hex, share: entry.n / total });
    if (result.length >= limit) break;
  }
  return result;
}
