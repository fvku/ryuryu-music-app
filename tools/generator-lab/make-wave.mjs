#!/usr/bin/env node
/**
 * Koheiから受け取った波の原版（未加工・カラー）を、アプリが読む形へ変換して`assets/waves/`へ置く。
 *
 *   node tools/generator-lab/make-wave.mjs <原版.png> [YYYY-MM]
 *   node tools/generator-lab/make-wave.mjs reference/wave2609.png          # 名前から2026-09と判断する
 *
 * **8bitグレースケールPNGにする。** 背景の合成はLuminosity（`docs/generator-weekly-design.md` §6.5）で
 * 波の輝度しか使わないため、色を落としても**出力は1階調も変わらない**。容量は約1/3になる。
 * 変換の重みはW3C Compositing 1 の `Lum()` と同じ 0.3 / 0.59 / 0.11 で、描画側と揃えてある。
 *
 * 原版は月ごとに違う（`docs/generator-weekly-design.md` §6.5・§9-3）。リポジトリには変換後だけを置き、
 * 原版は各自の手元に残す（`reference/`はGit管理外）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return buffer => {
    let c = 0xffffffff;
    for (const b of buffer) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

/** 8bit・非インターレースのPNGを読む（カラータイプ 0／2／6）。 */
function decodePng(file) {
  const buffer = readFileSync(file);
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error(`PNGではありません: ${file}`);
  let offset = 8, width = 0, height = 0, bpp = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![0, 2, 6].includes(data[9])) throw new Error(`未対応のPNG形式です（depth=${data[8]} colorType=${data[9]}）`);
      if (data[12] !== 0) throw new Error('インターレースPNGは未対応です');
      bpp = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 1;
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp, out = Buffer.allocUnsafe(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++], line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error(`未知のPNGフィルタ ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

/** 8bitグレースケールPNGを書く（Paethフィルタ固定）。 */
function encodeGrayPng(width, height, gray) {
  const raw = Buffer.allocUnsafe(height * (width + 1));
  for (let y = 0; y < height; y++) {
    const off = y * (width + 1);
    raw[off] = 4;
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? gray[y * width + x - 1] : 0;
      const b = y > 0 ? gray[(y - 1) * width + x] : 0;
      const c = (x > 0 && y > 0) ? gray[(y - 1) * width + x - 1] : 0;
      const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      raw[off + 1 + x] = (gray[y * width + x] - pred) & 0xff;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0;      // 8bit・グレースケール
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function monthOf(source, given) {
  if (given) {
    const match = /^(\d{4})-(\d{2})$/.exec(given);
    if (!match || +match[2] < 1 || +match[2] > 12) throw new Error(`対象月は YYYY-MM で指定してください: ${given}`);
    return { year: +match[1], month: +match[2] };
  }
  const match = /wave(\d{2})(\d{2})/.exec(path.basename(source));
  if (!match || +match[2] < 1 || +match[2] > 12) throw new Error(`ファイル名から対象月を判断できません。第2引数に YYYY-MM を渡してください: ${source}`);
  return { year: 2000 + +match[1], month: +match[2] };
}

const [source, given] = process.argv.slice(2);
if (!source) {
  console.error('使い方: node tools/generator-lab/make-wave.mjs <原版.png> [YYYY-MM]');
  process.exit(1);
}
const { year, month } = monthOf(source, given);
const image = decodePng(source);
if (image.width !== image.height) console.warn(`⚠️ 正方形ではありません（${image.width}×${image.height}）。版面は正方形前提です。`);
if (image.width !== 2400) console.warn(`⚠️ 2400pxではありません（${image.width}px）。書き出しは2400pxなので、これより小さいと粗くなります。`);

// アルファは書き出さない（描画側が不透明度50%を掛ける）。
// **一部だけ透明な原版は、そのまま落とすと透明だった場所が黒くつぶれる**ので、ここで止める。
// 全画素が同じαなら、それは「50%を焼き込んだ旧方式」なので落として構わない。
if (image.bpp === 4) {
  let min = 255, max = 0;
  for (let p = 3; p < image.data.length; p += 4) {
    const a = image.data[p];
    if (a < min) min = a;
    if (a > max) max = a;
  }
  if (max - min > 2) {
    console.error(`この原版は場所によって透明度が違います（α=${min}〜${max}）。`);
    console.error('そのまま変換すると、透明だった場所が黒い面になります。');
    console.error('背景を敷いた状態（不透明）で書き出し直したものを渡してもらってください。');
    process.exit(1);
  }
  if (max < 255) console.warn(`ℹ️ 全体に一様なα=${max}が焼き込まれています（旧方式）。輝度だけを取り出します。`);
}

const gray = new Uint8Array(image.width * image.height);
for (let i = 0, p = 0; i < gray.length; i++, p += image.bpp) {
  gray[i] = image.bpp === 1 ? image.data[p]
    : Math.round(0.3 * image.data[p] + 0.59 * image.data[p + 1] + 0.11 * image.data[p + 2]);
}

const name = `wave${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}.png`;
const outDir = path.join(import.meta.dirname, 'assets', 'waves');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, name);
const png = encodeGrayPng(image.width, image.height, gray);
writeFileSync(outFile, png);
const before = readFileSync(source).length;
console.log(`${year}年${month}月 → ${path.relative(process.cwd(), outFile)}`);
console.log(`  ${image.width}×${image.height}  ${(before / 1048576).toFixed(1)}MB → ${(png.length / 1048576).toFixed(2)}MB`);
console.log('  ※ この後 app/generator/runtime.tsx の BUNDLED_WAVES に追記してください。');
