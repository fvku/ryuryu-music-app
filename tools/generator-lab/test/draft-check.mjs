import test from 'node:test';
import assert from 'node:assert/strict';
import { demoPages } from '../model.mjs';
import { captureDraft, restoreDraft, validateDraft, validatePackage } from '../draft-model.mjs';
import { createDraftWriter, openDraftStore } from '../draft-store.mjs';
const options = { mode: 'adopted', size: 2400, useWave: false };
const fixture = () => captureDraft(demoPages(), options);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('all editable fields, typography, visibility, page identity/color and settings round-trip', async () => {
  const pages = demoPages();
  const slot = pages.adopted.slots[0];
  slot.fields.text = '明示\n改行🎵'; slot.fields.title = 'Title\n作品名';
  slot.tracking = .2; slot.kerns = { 0: -.4, 2: -.2 }; slot.bodyMaxLead = 35;
  slot.show.country = false; slot.show.title = false;
  for (const key of Object.keys(slot.fields).filter(key => key !== 'text')) {
    slot.typography[key] = { tracking: -.1, leading: 1.25, kerns: { 0: .3 } };
  }
  pages.listed.bgColor = '#123456'; pages.listed.slots.reverse();
  const snapshot = captureDraft(pages, options);
  const saved = JSON.parse(JSON.stringify(snapshot.document));
  slot.fields.title = 'later'; slot.typography.title.kerns[0] = .1;
  const restored = await restoreDraft({ document: saved, assets: {} }, 'sample-image', () => assert.fail());
  assert.deepEqual(captureDraft(restored.pages, restored), snapshot);
  assert.equal(restored.pages.adopted.slots[0].fields.title, 'Title\n作品名');
  assert.equal(restored.pages.adopted.slots[0].jacket.img, 'sample-image');
  assert.equal(restored.pages.listed.slots[0].id, 'sample-b');
});

test('manual image bytes survive independently of blob URL and DOM image', async () => {
  const pages = demoPages();
  const blob = new Blob(['test image'], { type: 'image/png' });
  pages.listed.slots[0].jacket = { source: 'manual', file: blob, img: { src: 'blob:temporary' } };
  const data = structuredClone(captureDraft(pages, options));
  assert.ok(!JSON.stringify(data.document).includes('blob:'));
  const restored = await restoreDraft(data, 'sample', async file => ({ decoded: await file.text() }));
  assert.deepEqual(restored.pages.listed.slots[0].jacket.img, { decoded: 'test image' });
  assert.equal(await restored.pages.listed.slots[0].jacket.file.text(), 'test image');
  assert.equal(restored.pages.listed.slots[1].jacket.img, 'sample');
});

test('runtime selection/history/source data and legacy slot color do not enter local format', () => {
  const pages = demoPages(), slot = pages.listed.slots[0];
  slot.selection = [1, 2]; slot.history = ['private']; slot.album.raw.token = 'do-not-copy'; slot.bgColor = '#ffffff';
  const data = captureDraft(pages, options);
  const serialized = JSON.stringify(data.document);
  for (const unwanted of ['selection', 'history', 'do-not-copy', '#ffffff']) assert.ok(!serialized.includes(unwanted));
});

test('future format, other scope and malformed references are rejected without modifying input', () => {
  const changes = [d => { d.schemaVersion = 999; }, d => { d.scope = 'another-user'; },
    d => { d.pages.listed.slots[1].id = d.pages.listed.slots[0].id; },
    d => { d.pages.adopted.slots = []; }, d => { d.theme.outputSize = 9600; },
    d => { d.pages.listed.bgColor = 'red'; }, d => { d.ui.mode = 'missing'; },
    d => { d.pages.listed.slots[0].fields.title = 42; },
    d => { d.pages.listed.slots[0].typography.title = { tracking: Infinity, leading: 1, kerns: {} }; },
    d => { d.pages.listed.slots[0].kerns = { 99999: -.1 }; },
    d => { d.pages.listed.slots[0].kerns = { 0: .3 }; },
    d => { d.pages.listed.slots[0].show.title = 'true'; },
    d => { d.pages.listed.slots[0].bodyMaxLead = NaN; }];
  for (const change of changes) {
    const data = fixture().document; change(data); const before = structuredClone(data);
    assert.throws(() => validateDraft(data)); assert.deepEqual(data, before);
  }
});

test('missing, oversized and wrong-type manual assets fail rather than saving a sample fallback', () => {
  for (const blob of [undefined, new Blob(['x'], { type: 'text/html' }), new Blob([''], { type: 'image/png' }),
    new Blob([new Uint8Array(10 * 1024 ** 2 + 1)], { type: 'image/png' })]) {
    const data = fixture(); data.document.pages.listed.slots[0].jacket = 'manual'; data.assets['sample-a'] = blob;
    assert.throws(() => validatePackage(data));
  }
});

test('image decode failure rejects the whole restoration and leaves snapshot untouched', async () => {
  const pages = demoPages();
  pages.listed.slots[0].jacket = { source: 'manual', file: new Blob(['bad'], { type: 'image/png' }) };
  const data = captureDraft(pages, options), before = structuredClone(data.document);
  await assert.rejects(restoreDraft(data, 'sample', async () => { throw new Error('invalid image'); }), /invalid image/);
  assert.deepEqual(data.document, before);
});

test('one listed item is valid and does not invent a second album', async () => {
  const pages = demoPages(); pages.listed.slots.pop();
  const restored = await restoreDraft(captureDraft(pages, options), 'sample', () => {});
  assert.equal(restored.pages.listed.slots.length, 1);
});

test('writer does not save initial sample and serializes newer edits behind in-flight save', async () => {
  let current = 'first'; const calls = [], states = [], first = deferred(), second = deferred();
  const writer = createDraftWriter({ capture: () => current,
    save(value) { calls.push(value); return calls.length === 1 ? first.promise : second.promise; },
    onState: event => states.push(event.state) });
  assert.equal(await writer.flush(), true); assert.deepEqual(calls, []);
  writer.changed(); const pending = writer.flush();
  current = 'newer'; writer.changed(); writer.flush();
  assert.deepEqual(calls, ['first']);
  first.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(writer.dirty, true); assert.ok(!states.includes('saved'));
  second.resolve(); assert.equal(await pending, true);
  assert.deepEqual(calls, ['first', 'newer']); assert.equal(writer.dirty, false);
  assert.equal(states.at(-1), 'saved');
});

test('writer retains dirty state on quota/transaction failure and retries latest snapshot', async () => {
  let fail = true, current = 'first'; const saved = [];
  const writer = createDraftWriter({ capture: () => current,
    async save(value) { if (fail) throw new Error('QuotaExceededError'); saved.push(value); } });
  writer.changed(); assert.equal(await writer.flush(), false); assert.equal(writer.dirty, true);
  fail = false; current = 'new'; writer.changed();
  assert.equal(await writer.flush(), true); assert.deepEqual(saved, ['new']); assert.equal(writer.dirty, false);
});

test('capture validation failure stays unsaved rather than reporting success', async () => {
  const writer = createDraftWriter({ capture: () => { throw new Error('bad snapshot'); }, save: () => assert.fail() });
  writer.changed(); assert.equal(await writer.flush(), false); assert.equal(writer.dirty, true);
});

test('unavailable IndexedDB produces actionable failure', async () => {
  await assert.rejects(openDraftStore(null), /保存を利用できません/);
});
