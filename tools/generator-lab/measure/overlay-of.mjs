#!/usr/bin/env node
/**
 * 表紙（Weekly `cover`）の色オーバーレイを実物投稿から検算する。
 *
 * 原理: 表紙の帯は各作品のジャケットを240×1200へcover-fitしたもので、その上に単色半透明が1枚乗る。
 * 同じジャケットは作品面（`2026_W-1`〜`W-5`）にセル(200,50)800×800で無加工のまま写っているので、
 *   dst = (1 - a) * src + a * C
 * を画素ごとに立てて最小二乗で解けば、オーバーレイの色Cと不透明度aが推定なしで出る。
 *
 *   node tools/generator-lab/measure/overlay-of.mjs [参照フォルダ]
 *   （既定は tools/generator-lab/reference/2026#36）
 *
 * 参照フォルダには実物投稿7枚（`2026_W-0.png`〜`2026_W-6.png`、2400×2400）を置く。
 * 期待値は docs/generator-weekly-design.md §6.2 ／ Layout.WEEKLY.COVER.OVERLAY と揃えること。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const RANK_TO_BAND = [2, 1, 3, 0, 4];   // Layout.WEEKLY.COVER.RANK_TO_BAND と同じ
const EXPECTED = { color: [0, 64, 199], alpha: 0.6 };   // #0040C7 @60%
const CH = 'RGB';

/** 最小限のPNGデコーダ（8bit・非インターレース・カラータイプ2/6）。実測にしか使わない。 */
function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`PNGではありません: ${file}`);
  let off = 8, width = 0, height = 0, bpp = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6)) throw new Error(`未対応のPNG形式です（depth=${data[8]} colorType=${data[9]}）: ${file}`);
      if (data[12] !== 0) throw new Error(`インターレースPNGは未対応です: ${file}`);
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.allocUnsafe(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error(`未知のPNGフィルタ ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

const px = (im, x, y) => {
  const i = (y * im.width + x) * im.bpp;
  return [im.data[i], im.data[i + 1], im.data[i + 2]];
};

/** 週タイトル2行と毛筆ロゴはオーバーレイの上に描かれるのでモデルの外。1200基準の座標で除外する。 */
const drawnOnTop = (x, y) =>
  (y > 440 && y < 730 && x > 330 && x < 870) || (y > 1010 && x > 440 && x < 760);

/** 最小二乗で dst = m * src + b を解く。m = 1 - a、b = a * C。 */
function fit(pairs) {
  const n = pairs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { alpha: 1 - m, color: ((sy - m * sx) / n) / (1 - m), n };
}

function main() {
  const dir = process.argv[2] || path.join(import.meta.dirname, '..', 'reference', '2026#36');
  const cover = decodePng(path.join(dir, '2026_W-0.png'));
  const scale = cover.width / 1200;        // 実物は2400×2400＝2倍。1200基準の版面へ換算する
  const all = [[], [], []];

  console.log(`参照: ${dir}（表紙 ${cover.width}×${cover.height}、版面の${scale}倍）\n`);
  for (let rank = 0; rank < 5; rank++) {
    const feature = decodePng(path.join(dir, `2026_W-${rank + 1}.png`));
    const fs = feature.width / 1200;
    const jacket = { x: 200 * fs, y: 50 * fs, size: 800 * fs };
    const band = RANK_TO_BAND[rank], bandX = band * 240 * scale;
    const mine = [[], [], []];
    for (let y = 20 * scale; y < 1180 * scale; y += 4) {
      for (let x = 4 * scale; x < 236 * scale; x += 2) {
        if (drawnOnTop((bandX + x) / scale, y / scale)) continue;
        // 240×1200へのcover-fitは正方形ジャケットを1200×1200へ拡大して中央240を切り出す
        const u = (x / scale + 480) / 1200, v = (y / scale) / 1200;
        const jx = Math.round(jacket.x + u * jacket.size), jy = Math.round(jacket.y + v * jacket.size);
        const src = px(feature, jx, jy);
        // 再標本化のずれが混ざらないよう、原寸側が平坦な画素だけ使う
        let flat = true;
        for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
          const near = px(feature, jx + dx, jy + dy);
          for (let k = 0; k < 3; k++) if (Math.abs(near[k] - src[k]) > 2) flat = false;
        }
        if (!flat) continue;
        const dst = px(cover, bandX + x, y);
        for (let k = 0; k < 3; k++) { mine[k].push([src[k], dst[k]]); all[k].push([src[k], dst[k]]); }
      }
    }
    const per = [0, 1, 2].map(k => { const f = fit(mine[k]); return `${CH[k]}: α=${f.alpha.toFixed(3)} C=${f.color.toFixed(1)}`; });
    console.log(`帯${band}（${rank + 1}位・2026_W-${rank + 1}、標本${mine[0].length}）  ${per.join('  ')}`);
  }

  console.log(`\n5本まとめ（標本 ${all[0].length}/ch）`);
  for (let k = 0; k < 3; k++) {
    const f = fit(all[k]);
    console.log(`  ${CH[k]}: α=${f.alpha.toFixed(4)}  オーバーレイ成分=${f.color.toFixed(2)}`);
  }

  let sum = 0, n = 0, max = 0;
  for (let k = 0; k < 3; k++) for (const [src, dst] of all[k]) {
    const e = Math.abs(((1 - EXPECTED.alpha) * src + EXPECTED.alpha * EXPECTED.color[k]) - dst);
    sum += e; n++; max = Math.max(max, e);
  }
  const hex = '#' + EXPECTED.color.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  console.log(`\n期待値 ${hex} @${EXPECTED.alpha * 100}% との残差: 平均${(sum / n).toFixed(3)}階調 / 最大${max.toFixed(1)}階調`);
  console.log('※ 実物投稿は手作業で作られているため、帯によってはトリミングが中央でないことがある（その帯だけ残差が大きく出る）。');
}

main();
