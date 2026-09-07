import { demoPages, loadImage } from './model.mjs';
import { captureDraft, restoreDraft } from './draft-model.mjs';
import { openDraftStore } from './draft-store.mjs';
import Fonts from './core/fonts.mjs';
import { renderTiled, canvasBlob, releaseCanvas } from './tiled-renderer.mjs';

const $ = id => document.getElementById(id);
const stageKey = 'generator-lab-recovery-check-stage';
const dbName = 'ryuryu-generator-lab-CHECKS-ONLY';
const results = [];
function pass(text) {
  results.push(text);
  const li = document.createElement('li'); li.textContent = `PASS · ${text}`; $('results').append(li);
}
function assert(ok, label) { if (!ok) throw new Error(label); }
async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}
let store, other;
try {
  $('environment').textContent = navigator.userAgent;
  store = await openDraftStore(indexedDB, dbName);
  if (!sessionStorage.getItem(stageKey)) {
    const pages = demoPages();
    pages.listed.slots[0].fields.title = '保存の確認\nUpper';
    pages.listed.slots[1].fields.title = '下段は独立';
    pages.listed.bgColor = '#123456';
    const slot = pages.adopted.slots[0];
    slot.fields.text = '明示改行の保存。\n文字の調整を復元する。';
    slot.tracking = -.02; slot.kerns = { 0: -.01 }; slot.bodyMaxLead = 39.2;
    slot.typography.title = { tracking: -.02, leading: 1.4, kerns: { 1: .01 } };
    const blob = await (await fetch('./assets/jacket_2000.webp')).blob();
    pages.listed.slots[0].jacket = { source: 'manual', file: blob };
    const value = captureDraft(pages, { mode: 'listed', size: 2400, useWave: false });
    other = await openDraftStore(indexedDB, dbName);
    const second = captureDraft(demoPages(), { mode: 'adopted', size: 1200, useWave: true });
    second.document.pages.adopted.slots[0].fields.title = 'Other tab';
    await Promise.all([store.save('check-main', value), other.save('check-other', second)]);
    const otherSaved = await other.load('check-other');
    assert(otherSaved.document.pages.adopted.slots[0].fields.title === 'Other tab', 'Concurrent draft isolation');
    // Only an expectation, no manual image payload, survives in sessionStorage.
    sessionStorage.setItem(stageKey, JSON.stringify({ document: value.document, imageSize: blob.size }));
    store.close(); other.close();
    location.reload();
  } else {
    const expected = JSON.parse(sessionStorage.getItem(stageKey));
    sessionStorage.removeItem(stageKey);
    const value = await store.load('check-main');
    assert(JSON.stringify(value.document) === JSON.stringify(expected.document), 'Snapshot changed after reload');
    pass('Real page reload: all fields + typography + color + settings');
    assert(value.assets['sample-a'].size === expected.imageSize, 'Image bytes missing');
    pass('IndexedDB: manual image Blob survives reload');
    assert((await store.load('check-other')).document.pages.adopted.slots[0].fields.title === 'Other tab', 'Other draft overwritten');
    pass('Two independent DB connections: drafts remain isolated');
    const [sample, wave] = await Promise.all([loadImage('./assets/jacket_2000.webp'), loadImage('./assets/wave.png'), Fonts.loadAll()]);
    const restored = await restoreDraft(value, sample, decode);
    assert(restored.pages.listed.slots[0].jacket.img.naturalWidth > 0, 'Image decode failed');
    assert(JSON.stringify(captureDraft(restored.pages, restored).document) === JSON.stringify(value.document), 'Restored model differs');
    pass('Restoration: image decode + full model round trip');
    await document.fonts.load('400 16px "Noto Sans JP"', '下書き保存復元');
    assert(document.fonts.check('400 16px "Noto Sans JP"', '下書き保存復元'), 'Japanese font missing');
    pass('Japanese UI webfont available');
    for (const kind of ['adopted', 'listed']) for (const size of [1200, 2400]) {
      const result = await renderTiled(restored.pages[kind], { wave }, { size });
      try {
        const png = await canvasBlob(result.canvas);
        assert(png.type === 'image/png' && png.size > 0, 'PNG is empty');
        const image = await decode(png);
        assert(image.naturalWidth === size && image.naturalHeight === size, 'Wrong PNG dimensions');
        pass(`${kind}: ${size} x ${size} PNG encoded + decoded`);
      } finally { releaseCanvas(result.canvas); }
    }
    $('result').textContent = `PASS ${results.length} / ${results.length}`;
  }
} catch (error) {
  $('result').textContent = `FAIL: ${error.message}`; $('result').className = 'error';
  sessionStorage.removeItem(stageKey);
} finally { store?.close(); other?.close(); }
