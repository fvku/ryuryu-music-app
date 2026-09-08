// weekly-v1（NEW RELEASE WEEK・作品面）のテスト。
// 実測の経緯・出典は generator-weekly-design.md §6.1・§12、Layout.WEEKLY のコメントを参照。
import test from 'node:test';
import assert from 'node:assert/strict';
import L from '../core/layout.mjs';
import P from '../core/pages.mjs';
import Render from '../core/render.mjs';
import F from '../core/fonts.mjs';

// 1文字30px（54pxのOswaldで実際にありうる程度の比率）。10pxだと±20%字間の効果(±10.8px/字)が
// グリフ幅そのものを上回ってしまい、「詰めても収まらない」ケースを作れなくなるため大きめにしてある。
const ctx = {
  measureText: text => ({ width: text.length * 30 }), fillText() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
  clearRect() {}, strokeRect() {}, fillRect() {}, drawImage() {},
};

console.log('Layout.WEEKLY — 実測値（generator-weekly-design.md §12「WEEK列の発見」で罫・パネルの前提を訂正した後の値）');
test('セル・ベースラインは実物投稿7枚の実測値のまま（勝手に丸めない）', () => {
  assert.deepStrictEqual(L.WEEKLY.CELLS.jacket, { x: 200, y: 50, w: 800, h: 800 });
  assert.deepStrictEqual(L.WEEKLY.CELLS.panel, { x: 200, y: 850, w: 800, h: 300 });
  assert.strictEqual(L.WEEKLY.TITLE_BASELINE, 948.5);
  assert.strictEqual(L.WEEKLY.ARTIST_BASELINE, 1017.5);
  assert.strictEqual(L.WEEKLY.META_BASELINE, 1096);
  assert.strictEqual(L.WEEKLY.META_GAP, 16);
});
test('META_CELLはbandLayoutの中央揃え式（cell.y+cell.h/2+13）でMETA_BASELINEを再現する', () => {
  const { y, h } = L.WEEKLY.META_CELL;
  assert.strictEqual(y + h / 2 + 13, L.WEEKLY.META_BASELINE);
});

console.log('\nfitWeeklyTitle — 内枠(752px)に収まらない作品名の字間自動詰め（Koheiの決定。§6.1・§6.4）');
const maxWidth = L.WEEKLY.CELLS.panel.w - 2 * L.WEEKLY.TITLE_INSET_X; // 752
test('内枠幅は800-24*2=752（Album 752×240の実測どおり）', () => {
  assert.strictEqual(maxWidth, 752);
});
test('すでに収まる作品名は既定の字間のまま変えない', () => {
  const fit = Render.fitWeeklyTitle(ctx, 'Short Title', -0.02, maxWidth);
  assert.deepStrictEqual(fit, { tracking: -0.02, overflow: false });
});
test('収まらない作品名は、収まる範囲でbaseTrackingに一番近い字間まで詰める', () => {
  // 35字: 既定の字間(-2%)では約1012pxではみ出すが、下限(-20%)なら約672pxに収まる。
  const text = 'A'.repeat(35);
  const fit = Render.fitWeeklyTitle(ctx, text, -0.02, maxWidth);
  assert.strictEqual(fit.overflow, false);
  assert.ok(fit.tracking > -0.2 && fit.tracking < -0.02, `字間は下限(-0.2)とbaseTracking(-0.02)の間のはず: ${fit.tracking}`);
  // 二分探索が正しい向きに収束しているかを直接検算する（逆向きだと"収まらない"側に寄ってしまう）。
  // これは実装時に符号を取り違えて起きた回帰で、この検算が無いと検出できなかった。
  const spec = Object.assign({}, L.WEEKLY.TYPE.title, { tracking: fit.tracking });
  const clusters = toClustersLike(text, spec, ctx);
  assert.ok(widthOfLike(clusters) <= maxWidth + 1e-6, '返ってきたtrackingで実際に収まること');
  // baseTrackingへわずかに近づける（緩める）と収まらなくなる、の境界性も確認する
  const looser = Object.assign({}, spec, { tracking: fit.tracking + 0.01 });
  const looserClusters = toClustersLike(text, looser, ctx);
  assert.ok(widthOfLike(looserClusters) > maxWidth, '字間を少し緩めると再びはみ出すはず（境界に収束している確認）');
});
test('下限(-20%)まで詰めても収まらない場合はoverflow:trueで止める（折り返しはしない。§6.1）', () => {
  // 90字: 下限(-20%)でも約1728pxで内枠752pxに収まらない。
  const fit = Render.fitWeeklyTitle(ctx, 'A'.repeat(90), -0.02, maxWidth);
  assert.deepStrictEqual(fit, { tracking: -0.2, overflow: true });
});

// TextEngineの内部実装（toClusters/prepare/widthOf）を素朴に再現した検算用ヘルパー。
// fitWeeklyTitle自体の実装は使わず、独立に「本当に収まっているか」を確認する。
function toClustersLike(text, spec, c) {
  const track = (spec.tracking || 0) * spec.size;
  return [{ adv: c.measureText(text).width + track * text.length }];
}
function widthOfLike(clusters) {
  return clusters.reduce((a, cl) => a + cl.adv, 0);
}

console.log('\ntoWeeklyDrawData → drawWeeklyFeature の橋渡し（型・存在確認）');
test('Render.drawWeeklyFeature / fitWeeklyTitle がエクスポートされている', () => {
  assert.strictEqual(typeof Render.drawWeeklyFeature, 'function');
  assert.strictEqual(typeof Render.fitWeeklyTitle, 'function');
});
test('makeSlot→toWeeklyDrawDataの型は{title,artist,meta,tracking,kerns,typography}', () => {
  const raw = { title: 'X', artist: 'Y', date: '2026-09-04', duration: '10songs, 34min 56sec', genreMemo: 'Alt-Pop', country: 'UK' };
  const slot = P.makeSlot(P.normalize(raw, 'monthly'), 'monthly');
  const d = P.toWeeklyDrawData(slot);
  assert.deepStrictEqual(Object.keys(d).sort(), ['artist', 'kerns', 'meta', 'title', 'tracking', 'typography']);
});

console.log('\nLayout.WEEKLY.OTHERS — Other Releasesの行送り自動調整（Koheiの決定。実物投稿30行で実測）');
test('実測値：30行で行送り29px・先頭行ベースライン248.5px（2026_W-6.pngで実測）', () => {
  assert.deepStrictEqual(L.WEEKLY.OTHERS.layoutFor(30), { lead: 29, baseline: 248.5 });
});
test('件数が変わると天地幅(841px)を均等に割り直す（詰める／広げる）', () => {
  // 15行なら天地幅は同じでも1行あたりの取り分は増える＝行送りは広がる
  const wide = L.WEEKLY.OTHERS.layoutFor(15);
  assert.ok(wide.lead > 29, `件数が減れば行送りは広がるはず: ${wide.lead}`);
  assert.strictEqual(wide.lead, 841 / 14);
  // 40行なら逆に詰まる
  const tight = L.WEEKLY.OTHERS.layoutFor(40);
  assert.ok(tight.lead < 29, `件数が増えれば行送りは詰まるはず: ${tight.lead}`);
});
test('1行だけなら天地の中央に置く（bodyLayoutForのn===1と同じ規則）', () => {
  const { BOX, ASCENT, DESCENT } = L.WEEKLY.OTHERS.BODY;
  const one = L.WEEKLY.OTHERS.layoutFor(1);
  assert.strictEqual(one.lead, 0);
  assert.strictEqual(one.baseline, (BOX.y + BOX.y + BOX.h) / 2 + (ASCENT - DESCENT) / 2);
});
test('行送りがフォントサイズ(29px)を下回る件数はfits()がfalseを返す（はみ出し扱い。§6.4）', () => {
  assert.strictEqual(L.WEEKLY.OTHERS.fits(30), true);   // 841/29 = 29.0 ちょうど
  assert.strictEqual(L.WEEKLY.OTHERS.fits(31), false);  // 841/30 ≈ 28.03 < 29
  assert.strictEqual(L.WEEKLY.OTHERS.fits(1), true);
});
test('Render.drawWeeklyOthers / Pages.toWeeklyOtherLine がエクスポートされている', () => {
  assert.strictEqual(typeof Render.drawWeeklyOthers, 'function');
  assert.strictEqual(typeof P.toWeeklyOtherLine, 'function');
});
test('toWeeklyOtherLineは"作品名 / アーティスト名"、[EP]は保持する', () => {
  const slot = { fields: { title: '[EP] 働くサバたち。', artist: 'サバシスター' }, show: { title: true, artist: true } };
  assert.strictEqual(P.toWeeklyOtherLine(slot), '[EP] 働くサバたち。 / サバシスター');
});
test('片方だけshow:falseなら区切りごと落ちる（両方falseなら空文字）', () => {
  assert.strictEqual(P.toWeeklyOtherLine({ fields: { title: 'X', artist: 'Y' }, show: { title: true, artist: false } }), 'X');
  assert.strictEqual(P.toWeeklyOtherLine({ fields: { title: 'X', artist: 'Y' }, show: { title: false, artist: false } }), '');
});

console.log('\nLayout.WEEKLY.COVER — 表紙（実物投稿2026_W-0.pngを実測。generator-weekly-design.md §6.2・§12）');
test('帯の並び[4,2,1,3,5]から、1〜5位→帯indexの逆写像が正しい', () => {
  // RANK_TO_BAND[rank0=1位] の帯にBAND_ORDER[それ]=1が来る、という往復が成立すること
  L.WEEKLY.COVER.BAND_ORDER.forEach((rank, bandIndex) => {
    assert.strictEqual(L.WEEKLY.COVER.RANK_TO_BAND[rank - 1], bandIndex);
  });
});
test('bandCellは240幅の帯を隙間なく5本並べる', () => {
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(L.WEEKLY.COVER.bandCell(i), { x: i * 240, y: 0, w: 240, h: 1200 });
});
test('オーバーレイはFigmaの原本値 #0040C7 の60%（実物投稿の画素回帰でも裏付け済み。§6.2）', () => {
  // 表紙の帯と作品面のジャケットから dst=(1-a)*src+a*C を解くと、5本中4本がα=0.599〜0.602・
  // C=(0, 63.5〜64.1, 198.6〜199.2)＝この値に一致する（tools/generator-lab/measure/overlay-of.mjs）。
  assert.strictEqual(L.WEEKLY.COVER.OVERLAY.color, 'rgba(0,64,199,0.6)');
});

test('週タイトルのベースライン・行送りは実測値のまま（勝手に丸めない）', () => {
  assert.strictEqual(L.WEEKLY.COVER.TITLE.LINE1_BASELINE, 581);
  assert.strictEqual(L.WEEKLY.COVER.TITLE.LINE2_BASELINE, 699);
  assert.strictEqual(L.WEEKLY.COVER.TITLE.LEAD, 118);
  assert.strictEqual(L.WEEKLY.COVER.TITLE.LINE2_BASELINE - L.WEEKLY.COVER.TITLE.LINE1_BASELINE, L.WEEKLY.COVER.TITLE.LEAD);
});
test('Render.drawWeeklyCover がエクスポートされている', () => {
  assert.strictEqual(typeof Render.drawWeeklyCover, 'function');
});

test('drawPage / inspectPage がcover・feature・othersをMonthlyの掲載枠に落とさず処理する', () => {
  const fields = { title: 'Album', artist: 'Artist', duration: '10songs, 34min', genreMemo: 'Pop', country: 'UK', trackNo: '', track: '', text: '' };
  const slot = { fields, show: { title: true, artist: true, duration: true, genreMemo: true, country: true, track: false }, tracking: 0, kerns: {}, typography: {}, jacket: { img: null } };
  assert.doesNotThrow(() => Render.drawPage(ctx, { kind: 'cover', slots: [slot], bgColor: '#123456', week: { year: 2026, number: 36 } }, {}));
  assert.doesNotThrow(() => Render.drawPage(ctx, { kind: 'feature', slots: [slot], bgColor: '#123456', week: { year: 2026, number: 36 } }, {}));
  assert.doesNotThrow(() => Render.drawPage(ctx, { kind: 'others', slots: [slot], bgColor: '#123456', week: { year: 2026, number: 36 } }, {}));
  assert.deepStrictEqual(Render.inspectPage(ctx, { kind: 'cover', slots: [slot] }), []);
  assert.ok(Render.inspectPage(ctx, { kind: 'others', slots: Array.from({ length: 31 }, () => slot) }).some(value => value.includes('最大30件')));
});

console.log('\nFonts — セルフホスト書体（表紙専用、失敗してもMonthly/Japanを止めない設計。§12）');
test('Alternate Gothic No2 D はSELF_HOSTEDに登録されていて、NEEDED（Google Fonts組）とは別枠', () => {
  assert.ok(F.SELF_HOSTED.some(f => f.family === 'Alternate Gothic No2 D'));
  assert.ok(!F.NEEDED.some(f => f.family === 'Alternate Gothic No2 D'));
});
test('coverFontReadyは関数として公開されている（表紙描画直前に個別確認するため）', () => {
  assert.strictEqual(typeof F.coverFontReady, 'function');
});
