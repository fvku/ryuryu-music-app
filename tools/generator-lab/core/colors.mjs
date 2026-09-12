// ============================================================
// colors.js — 背景色の変換とスポイド（SPEC.md §6）
//
// 背景は「色の面 ＋ 波」の合成で、**最終的に色を決めるのは人**（2026-09-04、Kohei の指示）。
// ジャケットからスポイドで拾い、彩度と明度をプレビューを見ながら調整する。
//
// 2026-09-12 更新：統合版では、ジャケットから拾った色を初期値・候補として出す
// （利用者の決定。`lib/generator/cover-color.ts`）。この検証版の自動抽出なしという扱いは
// 当時のままで、統合版の挙動とは別。
// ============================================================
const Colors = (() => {

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const hex2 = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

  /** {r,g,b} 0–255 → '#RRGGBB' */
  function toHex({ r, g, b }) { return '#' + hex2(r) + hex2(g) + hex2(b); }

  /** '#RGB' / '#RRGGBB' / 'RRGGBB' → {r,g,b}。読めなければ null */
  function fromHex(str) {
    const m = String(str || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(m))
      return { r: parseInt(m[0] + m[0], 16), g: parseInt(m[1] + m[1], 16), b: parseInt(m[2] + m[2], 16) };
    if (/^[0-9a-f]{6}$/i.test(m))
      return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
    return null;
  }

  /** {r,g,b} 0–255 → {h:0–360, s:0–1, v:0–1} */
  function toHsv({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
      h *= 60;
    }
    return { h, s: mx ? d / mx : 0, v: mx };
  }

  /** {h:0–360, s:0–1, v:0–1} → {r,g,b} 0–255 */
  function fromHsv({ h, s, v }) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); v = clamp(v, 0, 1);
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const i = Math.floor(h / 60) % 6;
    const [r, g, b] = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][i];
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }

  /**
   * canvas 上の1点の色を拾う（スポイド）。
   * @param {HTMLCanvasElement} canvas  実寸（Layout.CANVAS）で描かれている canvas
   * @param {number} sx, sy             canvas の CSS 座標（クリック位置。要素の左上からの px）
   * @returns {{r,g,b}}
   */
  function pick(canvas, sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(sx * canvas.width / rect.width);
    const y = Math.round(sy * canvas.height / rect.height);
    const d = canvas.getContext('2d').getImageData(
      clamp(x, 0, canvas.width - 1), clamp(y, 0, canvas.height - 1), 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  }

  /** 1200基準の点が、そのページのジャケットのセルの中かどうか（スポイドの案内に使う） */
  function jacketCellsOf(page) {
    if (!page) return [];
    if (page.kind === 'adopted') return [Layout.CELLS.jacket];
    return page.slots.map((_, i) => Layout.LISTED.cellsOf(i).jacket);
  }

  return { toHex, fromHex, toHsv, fromHsv, pick, jacketCellsOf, clamp };
})();

export default Colors;
