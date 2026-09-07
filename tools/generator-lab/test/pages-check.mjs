// pages_test.js — editor/js/pages.js の純関数の回帰テスト
//   node test/pages_test.js
// SPEC.md §7「並び順」「ページ構成」「ファイル名」「項目を『出さない』選択と書き出し時の中黒」
// および §7.5 の規則が、コードでそのまま成り立っているかを確かめる。
import assert from 'node:assert/strict';
import P from '../core/pages.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
const row = o => Object.assign({
  date: '2026-08-01', title: 't', artist: 'a', duration: '9songs, 29min 9sec',
  genreMemo: 'IDM / Indie Folk', country: 'US', mjTrackNo: '6', mjTrack: 'track',
  mjText: 'ほんぶん', mjAdoption: '採用', coverUrl: 'https://i.scdn.co/x', coverUrlLarge: '',
}, o);

console.log('groupOf — 企画ごとの mjAdoption の対応（SPEC §10）');
t('Monthly は 採用/掲載 を拾い J採用/J掲載 は拾わない', () => {
  assert.strictEqual(P.groupOf('採用',  'monthly'), 'adopted');
  assert.strictEqual(P.groupOf('掲載',  'monthly'), 'listed');
  assert.strictEqual(P.groupOf('J採用', 'monthly'), null);
  assert.strictEqual(P.groupOf('不採用','monthly'), null);
  assert.strictEqual(P.groupOf('',      'monthly'), null);
});
t('Japan は J採用/J掲載 だけを拾う', () => {
  assert.strictEqual(P.groupOf('J採用', 'japan'), 'adopted');
  assert.strictEqual(P.groupOf('J掲載', 'japan'), 'listed');
  assert.strictEqual(P.groupOf('採用',  'japan'), null);
});

console.log('yearMonth / dateKey — 表記ゆれに耐える');
t('区切り文字が違っても同じ年月になる', () => {
  for (const d of ['2026-08-15', '2026/8/15', '2026年8月15日'])
    assert.strictEqual(P.yearMonth(d), '2026-08');
});
t('読めない日付はソートの最後に送る', () => {
  assert.strictEqual(P.dateKey('未定'), Infinity);
  assert.ok(P.dateKey('2026-08-01') < P.dateKey('2026-08-02'));
  assert.ok(P.dateKey('2026-08') < P.dateKey('2026-08-01'));   // 日が無い → 0日扱い
});

console.log('sortGroup — SPEC §7「並び順」');
t('① リリース日の昇順', () => {
  const s = P.sortGroup([{date:'2026-08-20',artist:'a'},{date:'2026-08-05',artist:'z'}]);
  assert.deepStrictEqual(s.map(x => x.date), ['2026-08-05', '2026-08-20']);
});
t('② 同日はアーティスト名の a–z（タイトルではない）', () => {
  const s = P.sortGroup([
    { date:'2026-08-01', artist:'Zola',  title:'aaa' },
    { date:'2026-08-01', artist:'Ahmed', title:'zzz' },
  ]);
  assert.deepStrictEqual(s.map(x => x.artist), ['Ahmed', 'Zola']);
});
t('② 大小文字は区別しない', () => {
  const s = P.sortGroup([{date:'2026-08-01',artist:'apple'},{date:'2026-08-01',artist:'Ant'}]);
  assert.deepStrictEqual(s.map(x => x.artist), ['Ant', 'apple']);
});
t('② あいうえお順は取らない。同日なら欧文が先・和文が後ろ（SPEC §7 が受け入れた挙動）', () => {
  const s = P.sortGroup([
    { date:'2026-08-01', artist:'小袋成彬' },
    { date:'2026-08-01', artist:'あいうえお' },
    { date:'2026-08-01', artist:'Beach House' },
  ]);
  assert.deepStrictEqual(s.map(x => x.artist), ['Beach House', 'あいうえお', '小袋成彬']);
});
t('③ EP は日付が最も早くてもグループの末尾に来る', () => {
  const s = P.sortGroup([
    { date:'2026-08-20', artist:'b', title:'later' },
    { date:'2026-08-01', artist:'a', title:'[EP] earliest' },
  ]);
  assert.deepStrictEqual(s.map(x => x.title), ['later', '[EP] earliest']);
});
t('③ EP が複数あればそれら同士は通常の規則で並ぶ', () => {
  const s = P.sortGroup([
    { date:'2026-08-20', artist:'x', title:'[EP] late' },
    { date:'2026-08-02', artist:'y', title:'[EP] early' },
    { date:'2026-08-10', artist:'z', title:'plain' },
  ]);
  assert.deepStrictEqual(s.map(x => x.title), ['plain', '[EP] early', '[EP] late']);
});
t('EP の判定は全角括弧・大小文字を問わない。作品名からは外れる', () => {
  assert.ok(P.isEP({ title: '［ep］ foo' }));
  assert.ok(P.isEP({ title: '[EP] foo' }));
  assert.ok(!P.isEP({ title: 'epilogue' }));
  assert.strictEqual(P.stripEP('[EP] foo'), 'foo');
  assert.strictEqual(P.stripEP('foo'), 'foo');
});

console.log('selectAlbums / monthsIn — 絞り込み');
t('月と企画で絞り、不採用は落ちる', () => {
  const raws = [
    row({ date:'2026-08-01', mjAdoption:'採用' }),
    row({ date:'2026-07-01', mjAdoption:'採用' }),      // 別の月
    row({ date:'2026-08-02', mjAdoption:'不採用' }),     // 対象外
    row({ date:'2026-08-03', mjAdoption:'J採用' }),      // 別の企画
    row({ date:'2026-08-04', mjAdoption:'掲載' }),
  ];
  const got = P.selectAlbums(raws, '2026-08', 'monthly');
  assert.strictEqual(got.length, 2);
  assert.deepStrictEqual(got.map(a => a.group), ['adopted', 'listed']);
});
t('月セレクトの選択肢は取得結果から作る（新しい順）', () => {
  assert.deepStrictEqual(
    P.monthsIn([row({date:'2026-07-01'}), row({date:'2026-08-01'}), row({date:'2026-07-20'}), row({date:''})]),
    ['2026-08', '2026-07']);
});

console.log('paginate — SPEC §7「ページ構成」。採用は1件1画像、掲載は2件1画像');
const pagesOf = (nAdopted, nListed) => {
  const albums = [];
  for (let i = 0; i < nAdopted; i++) albums.push(P.normalize(row({ artist:'a'+i, mjAdoption:'採用' }), 'monthly'));
  for (let i = 0; i < nListed;  i++) albums.push(P.normalize(row({ artist:'b'+i, mjAdoption:'掲載' }), 'monthly'));
  return P.paginate(P.makeGroups(albums, 'monthly'));
};
t('採用5件・掲載6件 → 採用5画像(2–6) ＋ 掲載3画像(7–9)', () => {
  const pages = pagesOf(5, 6);
  assert.strictEqual(pages.length, 8);
  assert.deepStrictEqual(pages.map(p => p.no), [2,3,4,5,6,7,8,9]);
  assert.deepStrictEqual(pages.map(p => p.kind), ['adopted','adopted','adopted','adopted','adopted','listed','listed','listed']);
  assert.deepStrictEqual(pages.map(p => p.slots.length), [1,1,1,1,1,2,2,2]);
});
t('連番は 2 から始まる（表紙のぶんの 1 は空ける）', () => {
  assert.strictEqual(pagesOf(1, 0)[0].no, 2);
});
t('掲載が奇数なら最後の画像だけ1件になる（運用では起きない前提の安全弁。SPEC §7）', () => {
  const pages = pagesOf(0, 5);
  assert.deepStrictEqual(pages.map(p => p.slots.length), [2, 2, 1]);
});
t('枠数の上限・下限を持たない。採用12件でも12画像になる', () => {
  assert.strictEqual(pagesOf(12, 0).length, 12);
});
t('0件でもページは作られない（落ちない）', () => {
  assert.deepStrictEqual(pagesOf(0, 0), []);
});

console.log('move — グループ内の並べ替え（SPEC §7）');
t('隣と入れ替わり、ページを組み直しても同じ Slot が付いて回る', () => {
  const albums = ['a','b','c'].map(x => P.normalize(row({ artist:x }), 'monthly'));
  const groups = P.makeGroups(albums, 'monthly');
  groups.adopted[0].fields.title = '編集した';                    // 1枚目に手を入れる
  assert.strictEqual(P.move(groups, 'adopted', 0, 1), true);
  assert.deepStrictEqual(groups.adopted.map(s => s.album.artist), ['b','a','c']);
  const pages = P.paginate(groups);
  assert.strictEqual(pages[1].slots[0].fields.title, '編集した');  // 編集が移動先へ付いて回る
  assert.strictEqual(pages[1].no, 3);                             // 番号は並びから振り直る
});
t('端では動かない。グループを跨がない', () => {
  const groups = P.makeGroups(['a','b'].map(x => P.normalize(row({ artist:x }), 'monthly')), 'monthly');
  assert.strictEqual(P.move(groups, 'adopted', 0, -1), false);
  assert.strictEqual(P.move(groups, 'adopted', 1,  1), false);
});

console.log('filenameOf — SPEC §7「ファイル名」');
t('monthly_26_08_02 の形', () => {
  assert.strictEqual(P.filenameOf({ no: 2 },  'monthly', '2026-08'), 'monthly_26_08_02');
  assert.strictEqual(P.filenameOf({ no: 10 }, 'japan',   '2026-12'), 'japan_26_12_10');
});

console.log('帯 — SPEC §7「項目を『出さない』選択と、書き出し時の中黒」');
const slotOf = (over, program) => {
  const s = P.makeSlot(P.normalize(row(), program || 'monthly'), program || 'monthly');
  Object.assign(s.fields, (over && over.fields) || {});
  Object.assign(s.show,   (over && over.show)   || {});
  return s;
};
const textOf = segs => segs.map(x => x.text).join(' ');
t('全部あるとき', () => {
  assert.strictEqual(textOf(P.metaBand(slotOf())), '9songs, 29min 9sec ・ IDM / Indie Folk ・ US');
});
t('国が空 → 項目ごと飛ばし、末尾の中黒も消える（SPEC §7 の例そのまま）', () => {
  assert.strictEqual(textOf(P.metaBand(slotOf({ fields: { country: '' } }))),
    '9songs, 29min 9sec ・ IDM / Indie Folk');
});
t('「出さない」に切り替えても書き出しの挙動は同じ', () => {
  assert.deepStrictEqual(P.metaBand(slotOf({ show: { country: false } })),
                         P.metaBand(slotOf({ fields: { country: '' } })));
});
t('真ん中のジャンルが空 → 中黒が2つ並ばない', () => {
  assert.strictEqual(textOf(P.metaBand(slotOf({ fields: { genreMemo: '' } }))), '9songs, 29min 9sec ・ US');
});
t('先頭の曲数総尺が空 → 先頭に中黒が出ない', () => {
  assert.strictEqual(textOf(P.metaBand(slotOf({ fields: { duration: '' } }))), 'IDM / Indie Folk ・ US');
});
t('メタが全部空 → 帯は空になる', () => {
  assert.deepStrictEqual(P.metaBand(slotOf({ fields: { duration:'', genreMemo:'', country:'' } })), []);
});
t('Japan の 国 は既定で「出さない」', () => {
  const jp = P.makeSlot(P.normalize(row({ mjAdoption:'J採用' }), 'japan'), 'japan');
  assert.strictEqual(jp.show.country, false);
  assert.strictEqual(textOf(P.metaBand(jp)), '9songs, 29min 9sec ・ IDM / Indie Folk');
  const us = P.makeSlot(P.normalize(row(), 'monthly'), 'monthly');
  assert.strictEqual(us.show.country, true);       // Monthly は従来通り「出す」
});
t('RECOMMEND帯は M番号 を整形する', () => {
  assert.strictEqual(textOf(P.recBand(slotOf())), 'recommend - M6 track');
  assert.strictEqual(textOf(P.recBand(slotOf({ fields: { trackNo: 'M6' } }))), 'recommend - M6 track');
});
t('おすすめ曲が空 → recommend だけ残り、ハイフンも消える', () => {
  assert.strictEqual(textOf(P.recBand(slotOf({ fields: { trackNo:'', track:'' } }))), 'recommend');
  assert.strictEqual(textOf(P.recBand(slotOf({ show: { track: false } }))), 'recommend');
});
t('M番号だけ無い → 曲名は残る', () => {
  assert.strictEqual(textOf(P.recBand(slotOf({ fields: { trackNo:'' } }))), 'recommend - track');
});
t('大文字化はデータではなく描画時（textCase を持つ。SPEC §5）', () => {
  const segs = P.metaBand(slotOf());
  assert.strictEqual(segs[0].case, 'UPPER');
  assert.strictEqual(segs[0].text, '9songs, 29min 9sec');   // データは小文字のまま
  assert.strictEqual(P.metaBand(slotOf())[1].text, '・');    // 全角中黒（U+30FB）
  assert.strictEqual(P.metaBand(slotOf())[1].text.codePointAt(0), 0x30FB);
});

console.log('toDrawData — Render.draw に渡す形');
t('Phase 0 の参照データと同じ形（title/artist/meta/body/rec）＋ 本文のカーニング', () => {
  const d = P.toDrawData(slotOf());
  assert.deepStrictEqual(Object.keys(d).sort(), ['artist','body','bodyLeadMode','bodyMaxLead','kerns','meta','rec','title','tracking','typography']);
  assert.equal(d.bodyLeadMode, 'auto');
  assert.equal(d.bodyMaxLead, 42);
  assert.ok(Array.isArray(d.meta) && Array.isArray(d.rec));
  assert.strictEqual(typeof d.body, 'string');
  assert.strictEqual(d.tracking, 0);          // 既定は Figma と同じ 0
});
t('字間は Slot ごとに持ち、toDrawData が引き継ぐ', () => {
  const sl = slotOf();
  sl.tracking = -0.02;
  sl.kerns = { 5: -0.03, 6: -0.03 };
  const d = P.toDrawData(sl);
  assert.strictEqual(d.tracking, -0.02);
  assert.deepStrictEqual(d.kerns, { 5: -0.03, 6: -0.03 });
});
t('カーニングの既定は空（Figma の既定と同じ）', () => {
  const sl = slotOf();
  assert.deepStrictEqual(sl.kerns, {});
  assert.strictEqual(sl.tracking, 0);
});

console.log('isMissing — 黄色マスキングの判定（SPEC §7）');
t('空 かつ「出す」 → 黄色', () => {
  assert.strictEqual(P.isMissing(slotOf({ fields: { country:'' } }), 'country'), true);
});
t('「出さない」に切り替えた項目は黄色にしない（意図的なので警告不要）', () => {
  assert.strictEqual(P.isMissing(slotOf({ fields: { country:'' }, show: { country:false } }), 'country'), false);
});
t('値があれば黄色にしない', () => {
  assert.strictEqual(P.isMissing(slotOf(), 'country'), false);
});
t('空白だけの値も空とみなす', () => {
  assert.strictEqual(P.isMissing(slotOf({ fields: { genreMemo:'   ' } }), 'genreMemo'), true);
});
t('掲載枠に評価文は入らないので、空でも警告しない（SPEC §4）', () => {
  const s = slotOf({ fields: { text: '' } });
  assert.strictEqual(P.isMissing(s, 'text', { kind: 'listed' }), false);
  assert.strictEqual(P.isMissing(s, 'text', { kind: 'adopted' }), true);
});
t('M番号は show.track に従う（項目が束ねられている）', () => {
  assert.strictEqual(P.isMissing(slotOf({ fields:{trackNo:''}, show:{track:false} }), 'trackNo'), false);
  assert.strictEqual(P.isMissing(slotOf({ fields:{trackNo:''} }), 'trackNo'), true);
});

console.log(`\n${n} 件すべて通った`);
