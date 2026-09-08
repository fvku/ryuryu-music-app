import test from 'node:test';
import assert from 'node:assert/strict';
import L from '../core/layout.mjs';
import T from '../core/textEngine.mjs';
import { bandLayout, titleLayout, drawTitleLayout, drawBandLayout } from '../core/text-layout.mjs';
import { demoPages, snapshotPage } from '../model.mjs';
import { fieldAdapter } from '../core/field-type.mjs';
import { setSpacing, spacingValue } from '../spacing.mjs';

const ctx = { measureText: text => ({ width: text.length * 10 }), fillText() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
const segments = [{text:'a'.repeat(20), key:'duration'}, {text:'・'}, {text:'b'.repeat(20), key:'genreMemo'}];
test('metadata defaults its preferred gap to Layout.TEXT.bandGap (Figma実測 24.5)', () => {
  // 帯の要素間の既定アキは実測値 24.5px（SPEC.md §5「帯の構造」）。preferredGap を
  // 明示指定しない呼び出しでは、十分広いセルでもこの値未満に縮めない。
  const layout = bandLayout(ctx, segments, L.TYPE.meta, { x:50, y:510, w:1100, h:74 });
  assert.equal(layout.gap, L.TEXT.bandGap);
});
test('metadata tightens only separator gaps and reserves both 25px margins', () => {
  const cell = { x:50, y:510, w:540, h:74 };
  const layout = bandLayout(ctx, segments, L.TYPE.meta, cell, {}, 50);
  assert.equal(layout.margin, 25); assert.equal(layout.gap, 40);
  assert.equal(layout.total, cell.w - 50); assert.equal(layout.overflow, false);
  assert.equal(layout.parts[0].width, 200);
  drawBandLayout(ctx, layout);
});
test('metadata allows gaps below 25px, but never negative gaps', () => {
  const layout = bandLayout(ctx, segments, L.TYPE.meta, {x:0,y:0,w:500,h:74}, {}, 50);
  assert.equal(layout.margin, 25); assert.equal(layout.gap, 20); assert.equal(layout.overflow, false);
  const exact = bandLayout(ctx, segments, L.TYPE.meta, {x:0,y:0,w:460,h:74}, {}, 50);
  assert.equal(exact.gap, 0); assert.equal(exact.overflow, false);
  const overflow = bandLayout(ctx, segments, L.TYPE.meta, {x:0,y:0,w:450,h:74}, {}, 50);
  assert.equal(overflow.gap, 0); assert.equal(overflow.overflow, true);
});
test('field typography applies to both mixed titles and multi-line metadata', () => {
  const d = { title:'静かな\nAlbum', artist:'Artist', typography:{ title:{ tracking:-.02, kerns:{0:-.01}, leading:1.5 } } };
  const title = titleLayout(ctx, d, L.CELLS.title);
  assert.equal(title.titleLead, 81); drawTitleLayout(ctx, title);
  const band = bandLayout(ctx, [{text:'Jazz\nFolk', key:'genreMemo'}], L.TYPE.meta, L.CELLS.meta, {genreMemo:{leading:1, tracking:-.02}});
  assert.equal(band.parts[0].lead, 32); assert.equal(band.overflow, false); drawBandLayout(ctx, band);
});
test('changing an individual field leaves other fields and render snapshots intact', () => {
  const page = demoPages().adopted, slot = page.slots[0];
  setSpacing(fieldAdapter(slot, 'genreMemo'), [0,4], -.03);
  const snapshot = snapshotPage(page);
  setSpacing(fieldAdapter(slot, 'genreMemo'), [0,4], -.1);
  assert.equal(spacingValue(fieldAdapter(snapshot.slots[0], 'genreMemo'), [0,4]), -.03);
  assert.equal(spacingValue(fieldAdapter(slot, 'country'), [0,2]), 0);
  assert.equal(slot.tracking, 0);
});
test('a selected character inside a Latin word changes the actual glyph positions', () => {
  const drawn = []; const context = {...ctx, fillText:(text,x) => drawn.push([text,x])};
  T.drawSingle(context, 'ABC', {...L.TYPE.body, kerns:{0:-.1}}, {x:0,baseline:20});
  assert.equal(drawn.length, 3);
  assert.ok(Math.abs(drawn[1][1] - 7.2) < 1e-9);
});
test('spacing on a word separator moves the next word in normal and mixed text', () => {
  for (const mixed of [false, true]) {
    const cls = T.toClusters('A B');
    const spec = {...L.TYPE.body, kerns:{1:-.1}};
    if (mixed) T.prepareMixed(ctx, cls, spec, spec); else T.prepare(ctx, cls, spec);
    assert.ok(Math.abs(cls[0].adv - 17.2) < 1e-9);
    assert.ok(Math.abs(T.widthOf(cls) - 27.2) < 1e-9);
  }
});
