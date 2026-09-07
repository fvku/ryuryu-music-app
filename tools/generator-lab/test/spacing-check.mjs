import test from 'node:test';
import assert from 'node:assert/strict';
import { spacingValue, setSpacing } from '../spacing.mjs';

const slot = () => ({ fields: { text: 'あいうえお' }, tracking: -.02, kerns: { 1: -.02, 4: .01 } });

test('Mixed compares effective spacing, including baseline and per-character overrides', () => {
  const s = slot();
  assert.equal(spacingValue(s, [0, 2]), null);
  assert.equal(spacingValue(s, [1, 2]), -.04);
  assert.equal(spacingValue(s, [2, 4]), -.02);
  assert.equal(spacingValue(s, [0, 0]), null);
});

test('entering an absolute value unifies the selected range without changing other characters', () => {
  const s = slot();
  setSpacing(s, [0, 3], -.03);
  assert.equal(spacingValue(s, [0, 3]), -.03);
  assert.equal(spacingValue(s, [3, 4]), -.02);
  assert.equal(spacingValue(s, [4, 5]), -.01);
  setSpacing(s, [0, 3], -.03);
  assert.equal(spacingValue(s, [0, 3]), -.03);
  assert.equal(s.tracking, -.02);
});

test('zero is a valid range value and no selection targets the whole body', () => {
  const s = slot(); setSpacing(s, [1, 2], 0);
  assert.equal(spacingValue(s, [1, 2]), 0);
  assert.equal(spacingValue(s, [0, 1]), -.02);
  setSpacing(s, [2, 2], -.05);
  assert.equal(spacingValue(s, [0, 5]), -.05);
  assert.deepEqual(s.kerns, {});
});
