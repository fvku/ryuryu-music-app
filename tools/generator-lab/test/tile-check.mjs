import test from 'node:test';
import assert from 'node:assert/strict';
import { tilePlan, renderTiled } from '../tiled-renderer.mjs';
import { demoPages, snapshotPage } from '../model.mjs';

test('each output pixel is covered once, including partial edge tiles', () => {
  for (const size of [1200, 2400]) {
    const plan = tilePlan(size);
    const coverage = new Uint8Array(size * size);
    for (const tile of plan.tiles) {
      assert.ok(tile.x + tile.width <= size && tile.y + tile.height <= size);
      for (let y = tile.y; y < tile.y + tile.height; y++) {
        for (let x = tile.x; x < tile.x + tile.width; x++) coverage[y * size + x]++;
      }
    }
    assert.ok(coverage.every(count => count === 1));
    assert.ok(plan.estimatedPixelBytes < 41 * 1024 ** 2);
  }
});

test('unsupported sizes fail before any browser allocation', () => {
  for (const size of [0, -1, NaN, Infinity, 2401, 1.5]) {
    assert.throws(() => tilePlan(size), RangeError);
  }
});

test('already cancelled render performs no font or canvas work', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderTiled(demoPages().listed, {}, { signal: controller.signal }), { name: 'AbortError' });
});

test('snapshot isolates edits while preserving the page-wide background', () => {
  const pages = demoPages();
  const snapshot = snapshotPage(pages.listed);
  pages.listed.slots[0].fields.title = 'edited upper';
  pages.listed.slots[0].show.track = false;
  pages.listed.slots[0].kerns[0] = 0.2;
  pages.listed.bgColor = '#123456';
  assert.notEqual(snapshot.slots[0].fields.title, 'edited upper');
  assert.equal(snapshot.slots[0].show.track, true);
  assert.deepEqual(snapshot.slots[0].kerns, {});
  assert.equal(snapshot.slots[1].fields.title, '遠くの街から');
  assert.equal(snapshot.bgColor, '#675479');
  assert.equal(pages.adopted.bgColor, '#405f69');
});
