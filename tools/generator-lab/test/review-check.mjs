import test from 'node:test';
import assert from 'node:assert/strict';
import Render from '../core/render.mjs';
import Layout from '../core/layout.mjs';
import TextEngine from '../core/textEngine.mjs';
import { projectReview, projectedEdit, displayOffset, replaceReview, adjacentGrapheme } from '../review-projection.mjs';

const ctx = { measureText: text => ({ width: text.length * 28 }) };
const linesFor = text => TextEngine.layoutParagraph(ctx, text, Layout.TYPE.body, 120);

test('soft wrapping preserves the complete source and maps both sides of the break', () => {
  const text = 'あいうえおかきくけこ';
  const projection = projectReview(text, linesFor(text));
  assert.equal(projection.display, 'あいうえ\nおかきく\nけこ');
  assert.equal(projection.toSource[4], 4);
  assert.equal(projection.toSource[5], 4);
  for (let i = 0; i <= text.length; i++) assert.equal(projection.toSource[displayOffset(projection, i)], i);
  assert.equal(projection.display.replaceAll('\n', ''), text);
});

test('explicit paragraphs, blank lines and trailing newline retain their source offsets', () => {
  const text = 'あいうえお\n\nかき\n';
  const projection = projectReview(text, linesFor(text));
  assert.equal(projection.display, 'あいうえ\nお\n\nかき\n');
  assert.deepEqual(linesFor(text).map(l => text.slice(l.start, l.end)), ['あいうえ', 'お', '', 'かき', '']);
});

test('editing a displayed later line never inserts its soft newline into the source', () => {
  const text = 'あいうえおかきくけこ';
  const projection = projectReview(text, linesFor(text));
  const edit = projectedEdit(projection, projection.display.replace('かき', '新文'));
  const next = replaceReview(text, {}, edit.start, edit.end, edit.inserted);
  assert.equal(next.text, 'あいうえお新文くけこ');
  assert.ok(!next.text.includes('\n'));
});

test('inserting an explicit newline at an automatic break creates exactly one source newline', () => {
  const text = 'あいうえおか';
  const projection = projectReview(text, linesFor(text));
  const nextDisplay = projection.display.slice(0, 5) + '\n' + projection.display.slice(5);
  const edit = projectedEdit(projection, nextDisplay);
  const next = replaceReview(text, {}, edit.start, edit.end, edit.inserted);
  assert.equal(next.text, 'あいうえ\nおか');
});

test('replacement across a soft break updates only the source selection', () => {
  const text = 'あいうえおかき'; const p = projectReview(text, linesFor(text));
  const next = p.display.replace('え\nおか', '追加');
  const edit = projectedEdit(p, next);
  assert.equal(replaceReview(text, {}, edit.start, edit.end, edit.inserted).text, 'あいう追加き');
});

test('kerning follows unaffected characters after replacement', () => {
  const next = replaceReview('あいうえお', { 0: .1, 2: .2, 4: .3 }, 1, 3, '新');
  assert.equal(next.text, 'あ新えお');
  assert.deepEqual(next.kerns, { 0: .1, 3: .3 });
});

test('backspace across a view break removes a whole grapheme', () => {
  const text = 'あ👨‍👩‍👧‍👦い';
  assert.equal(adjacentGrapheme(text, text.length - 1, -1), 1);
  assert.equal(adjacentGrapheme('あか\u3099い', 3, -1), 1);
});

test('automatic bodies maximize the 25px vertical margins; a manual cap remains centred', () => {
  const band = Layout.bodyBand();
  for (const count of [2, 3, 5, 7, 9]) {
    const { lead, baseline } = Layout.bodyLayoutFor(count);
    assert.equal(lead, (band.last - band.first) / (count - 1));
    const top = baseline - Layout.TEXT.bodyAscent;
    const bottom = baseline + lead * (count - 1) + Layout.TEXT.bodyDescent;
    assert.equal((top + bottom) / 2, (band.top + band.bottom) / 2);
  }
  assert.equal(Layout.bodyLayoutFor(5, 42).lead, 42);
  assert.ok(!Layout.bodyFits(15));
});

test('editor lines and actual body rendering share line boundaries and leading', () => {
  const text = 'あいうえお'.repeat(30) + '\n明示した段落';
  const drawn = [];
  const context = { ...ctx, fillText: (text, x, y) => drawn.push({ text, x, y }) };
  const lines = Render.bodyLines(context, text, 0, {});
  Render.drawBody(context, text, 0, {}, 42, 'custom');
  const { baseline, lead } = Layout.bodyLayoutFor(lines.length, 42);
  lines.forEach((line, i) => {
    const actual = drawn.filter(g => g.y === baseline + i * lead).map(g => g.text).join('');
    assert.equal(actual, text.slice(line.start, line.end));
  });
});
