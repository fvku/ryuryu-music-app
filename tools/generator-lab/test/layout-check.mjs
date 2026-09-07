// layout_test.js — 版面の実数と、セルから文字位置を決める規則の回帰テスト
//   node test/layout_test.js
//
// ここに書いてある数値は**すべて参照画像からの実測値**（SPEC.md §4・§5・§6）。
// 定数を触ったときに、どの実測と食い違ったのかが分かるようにするためのもの。
import assert from 'node:assert/strict';
import L from '../core/layout.mjs';
import C from '../core/colors.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };

console.log('採用枠のセル — reference/figma.png の実測（SPEC §4）');
t('罫は6px、セルの外側', () => {
  assert.strictEqual(L.RULE, 6);
});
t('5つのセルから、実測した罫の位置がすべて導かれる', () => {
  // 実測: 横罫 y44–50 / 504–510 / 584–590 / 610–616 / 1070–1076 / 1150–1156
  const edges = new Set();
  for (const c of Object.values(L.CELLS)) { edges.add(c.y - L.RULE); edges.add(c.y + c.h); }
  for (const y of [44, 504, 584, 610, 1070, 1150]) assert.ok(edges.has(y), `横罫 ${y} が出ない`);
});
t('454 ＋ 罫6 ＋ 74 ＝ 534（Album も Review も同じ内訳）', () => {
  assert.strictEqual(L.CELLS.jacket.h + L.RULE + L.CELLS.meta.h, 534);
  assert.strictEqual(L.CELLS.body.h + L.RULE + L.CELLS.rec.h, 534);
});

console.log('\n掲載枠のセル — reference/listed.png の実測（SPEC §4）');
t('ブロックの上端は 77 と 643（ピッチ 566）', () => {
  assert.deepStrictEqual(L.LISTED.GROUP_TOP, [77, 643]);
  assert.strictEqual(L.LISTED.GROUP_TOP[1] - L.LISTED.GROUP_TOP[0], 566);
});
t('ジャケットは 374×374 の正方形', () => {
  const j = L.LISTED.cellsOf(0).jacket;
  assert.strictEqual(j.w, 374);
  assert.strictEqual(j.h, 374);
});
t('実測した罫の位置がセルから導かれる（全幅の横罫8本）', () => {
  const edges = new Set();
  for (const i of [0, 1]) for (const c of Object.values(L.LISTED.cellsOf(i))) { edges.add(c.y - L.RULE); edges.add(c.y + c.h); }
  for (const y of [71, 451, 477, 557, 637, 1017, 1043, 1123]) assert.ok(edges.has(y), `横罫 ${y} が出ない`);
});
t('右カラムだけの横罫 371 / 937 は、作品名セルの下端から出る', () => {
  assert.strictEqual(L.LISTED.cellsOf(0).title.y + L.LISTED.cellsOf(0).title.h, 371);
  assert.strictEqual(L.LISTED.cellsOf(1).title.y + L.LISTED.cellsOf(1).title.h, 937);
});
t('縦罫 x424–430 は、ジャケットセルの右端から出る', () => {
  const j = L.LISTED.cellsOf(0).jacket;
  assert.strictEqual(j.x + j.w, 424);
});
t('区切りの背景素通しは 20px（採用枠と同じ）', () => {
  const c = L.LISTED.cellsOf(0);
  assert.strictEqual(c.rec.y - L.RULE - (c.jacket.y + c.jacket.h + L.RULE), 20);
});

console.log('\n作品名・アーティスト名の位置 — かたまりでセル内に縦中央（SPEC §5）');
const bl = (cell, n) => { const b = L.titleBaselines(cell, n); return [b.title, b.artist]; };
t('採用・2行 figma.png → 230 / 368', () => {
  assert.deepStrictEqual(bl(L.CELLS.title, 2), [230, 368]);
});
t('採用・1行 title1line.png → 266 / 332（実測 266 / 331.5）', () => {
  assert.deepStrictEqual(bl(L.CELLS.title, 1), [266, 332]);
});
t('掲載・上ブロック listed.png → 213 / 279', () => {
  assert.deepStrictEqual(bl(L.LISTED.cellsOf(0).title, 1), [213, 279]);
});
t('掲載・下ブロック listed.png → 779 / 845', () => {
  assert.deepStrictEqual(bl(L.LISTED.cellsOf(1).title, 1), [779, 845]);
});
t('最終行→アーティストの間隔は行数によらず 66', () => {
  for (const k of [1, 2, 3, 4]) {
    const b = L.titleBaselines(L.CELLS.title, k);
    assert.strictEqual(b.artist - (b.title + (k - 1) * L.TEXT.titleLead), 66);
  }
});
t('行が1本増えると作品名は半行上がり、アーティストは半行下がる', () => {
  const a = L.titleBaselines(L.CELLS.title, 1), b = L.titleBaselines(L.CELLS.title, 2);
  assert.strictEqual(a.title - b.title, L.TEXT.titleLead / 2);
  assert.strictEqual(b.artist - a.artist, L.TEXT.titleLead / 2);
});
t('セルからの相対で決まる規則は採用枠・掲載枠で共通', () => {
  assert.strictEqual(L.TEXT.titleX - L.CELLS.title.x, L.TEXT_RULE.titleInsetX);          // 542 − 510 = 32
  assert.strictEqual(L.TEXT.metaBaseline - L.CELLS.meta.y, L.TEXT_RULE.bandBaseline);    // 560 − 510 = 50
  assert.strictEqual(L.TEXT.recBaseline  - L.CELLS.rec.y,  L.TEXT_RULE.bandBaseline);    // 1126 − 1076 = 50
});

console.log('\n本文の行送り — 天地幅を埋める（SPEC §5）');
t('左右と同じ余白 25 を上下にも取り、天地は 404', () => {
  const B = L.bodyBand();
  assert.strictEqual(B.top, 641);            // セル上端 616 + 25
  assert.strictEqual(B.bottom, 1045);        // セル下端 1070 − 25
  assert.strictEqual(B.bottom - B.top, 404);
});
t('左右の余白は実測どおり 25（白枠 x50/1150 に対しインク 75/1125）', () => {
  assert.strictEqual(L.TEXT.bodyX - L.CELLS.body.x, 24.25);          // 枠の定義上の左余白
  assert.strictEqual(L.TEXT.bodyPad, 25);                            // インクで実測した余白
});
t('上限に達しない多行本文は上端に揃う', () => {
  for (const n of [11, 12, 14]) assert.strictEqual(L.bodyLayoutFor(n).baseline, 664.25);
});
t('上限に達しない多行本文は下端まで使う', () => {
  for (const n of [11, 12, 14]) {
    const { lead, baseline } = L.bodyLayoutFor(n);
    assert.strictEqual(+(baseline + (n - 1) * lead).toFixed(6), 1042.75);
  }
});
t('上限を60に指定すれば従来の8行配置を再現できる', () => {
  assert.ok(Math.abs(L.bodyLayoutFor(8, 60).lead - 54) < 0.1);
});
t('自動時は短い本文も天地25pxまで最大化する', () => {
  for (const n of [2, 7, 9, 10, 14]) {
    const { first, last } = L.bodyBand();
    const { lead, baseline } = L.bodyLayoutFor(n);
    assert.equal(baseline, first);
    assert.equal(+(baseline + (n - 1) * lead).toFixed(6), last);
  }
});
t('手動上限42pxなら本文のかたまりを天地中央に置く', () => {
  assert.equal(L.bodyLayoutFor(7, 42).lead, 42);
  assert.equal(L.bodyLayoutFor(9, 42).lead, 42);
});
t('行数が増えるほど行送りは詰まる', () => {
  let prev = Infinity;
  for (const n of [6, 7, 8, 9, 10]) { const v = L.bodyLead(n); assert.ok(v <= prev); prev = v; }
});
t('1行なら天地の中央に置く', () => {
  const b = L.bodyLayoutFor(1);
  const B = L.bodyBand();
  assert.strictEqual(b.lead, 0);
  assert.strictEqual((b.baseline - L.TEXT.bodyAscent + b.baseline + L.TEXT.bodyDescent) / 2, (B.top + B.bottom) / 2);
});
t('行送りが文字サイズを下回るほど行数が多いと成立しない', () => {
  assert.ok(L.bodyFits(14));
  assert.ok(L.bodyLead(14) >= 28);
  assert.ok(L.bodyLead(15) < 28);
  assert.ok(!L.bodyFits(15));
});

console.log('\n背景の合成（SPEC §6）');
t('波に重ねて不透明度を掛けない。50% は波PNGのアルファに焼き込まれている', () => {
  assert.strictEqual(L.BACKGROUND.waveOpacity, 1);
});

console.log('\n色の変換（SPEC §6）');
t('実測した色の面 #B21555 が往復する', () => {
  const rgb = C.fromHex('#B21555');
  assert.deepStrictEqual(rgb, { r: 178, g: 21, b: 85 });
  assert.strictEqual(C.toHex(rgb), '#b21555');
  assert.deepStrictEqual(C.fromHsv(C.toHsv(rgb)), rgb);
});
t('3桁の指定と、読めない指定', () => {
  assert.deepStrictEqual(C.fromHex('#abc'), { r: 170, g: 187, b: 204 });
  assert.strictEqual(C.fromHex('ちがう'), null);
  assert.strictEqual(C.fromHex(''), null);
});
t('彩度0なら灰色、明度0なら黒', () => {
  assert.deepStrictEqual(C.fromHsv({ h: 200, s: 0, v: 0.5 }), { r: 128, g: 128, b: 128 });
  assert.deepStrictEqual(C.fromHsv({ h: 200, s: 1, v: 0 }), { r: 0, g: 0, b: 0 });
});

console.log(`\n${n} 件すべて通った`);
