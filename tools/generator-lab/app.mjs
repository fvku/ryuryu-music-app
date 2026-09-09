import { selectionOverlay } from './selection-overlay.mjs';
import { fieldAdapter, fieldType, defaultLeading } from './core/field-type.mjs';
import { replaceReview } from './review-projection.mjs';
import Render from './core/render.mjs';
import { spacingValue, setSpacing } from './spacing.mjs';
import Fonts from './core/fonts.mjs';
import { demoPages, snapshotPage, loadImage } from './model.mjs';
import { renderTiled, canvasBlob, releaseCanvas } from './tiled-renderer.mjs';
import { createReviewEditor } from './review-editor.mjs';
import Layout from './core/layout.mjs';
import { captureDraft, restoreDraft } from './draft-model.mjs';
import { createDraftPanel } from './draft-panel.mjs';

const $ = id => document.getElementById(id);
const pages = demoPages();
let draftPanel;
let sampleImage;
let restoring = false;
let pendingImages = 0;
let restoreGeneration = 0;
const jacketRequests = new WeakMap();
const images = { wave: null };
let mode = 'listed';
let revision = 0;
let readyRevision = -1;
let ready = false;
let size = 2400;
let controller;
let activeRender = Promise.resolve();
let timer;
let generated;
let generatedUrl;
let canvas;
const localImageUrls = new Set();
let reviewEditors = [];
let formattingControllers = [];
let exportAllowed = false;

function clearPNG() {
  generated = null;
  if (generatedUrl) URL.revokeObjectURL(generatedUrl);
  generatedUrl = null;
  $('share-png').hidden = true;
  $('download-png').hidden = true;
  $('download-png').removeAttribute('href');
  $('export-status').textContent = '';
}

function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}

function changed(persist = true) {
  revision++;
  exportAllowed = false;
  clearPNG();
  controller?.abort();
  clearTimeout(timer);
  $('prepare-png').disabled = true;
  $('preview').setAttribute('aria-busy', 'true');
  if (ready) timer = setTimeout(queueRender, 180);
  if (persist) draftPanel?.changed();
}

function queueRender() {
  controller?.abort();
  const localController = new AbortController();
  controller = localController;
  const atRevision = revision;
  const page = snapshotPage(pages[mode]);
  const outputSize = size;
  const drawingImages = { wave: $('use-wave').checked ? images.wave : null };
  // A cancelled render must release its scratch buffers before the next starts.
  activeRender = activeRender.catch(() => {}).then(async () => {
    if (localController.signal.aborted) return;
    releaseCanvas(canvas);
    canvas = null;
    $('preview').replaceChildren();
    try {
      const result = await renderTiled(page, drawingImages, {
        size: outputSize, signal: localController.signal,
        onProgress: (done, total) => status(`プレビューを更新しています… ${Math.round(done / total * 100)}%`),
      });
      if (atRevision !== revision) { releaseCanvas(result.canvas); return; }
      canvas = result.canvas;
      canvas.setAttribute('aria-label', page.kind === 'listed' ? '上下2アルバムの掲載画像' : '採用アルバムの画像');
      $('preview').replaceChildren(canvas);
      $('preview').setAttribute('aria-busy', 'false');
      readyRevision = atRevision;
      for (const editor of reviewEditors) editor.refresh(canvas, outputSize);
      for (const controller of formattingControllers) controller.refresh();
      const warnings = Render.inspectPage(canvas.getContext('2d'), page);
      exportAllowed = warnings.length === 0;
      $('prepare-png').disabled = !exportAllowed;
      status(warnings.length ? `${warnings.join('。')}。字間・行送り・改行・表示項目を調整してください。` : `${outputSize} × ${outputSize} · プレビュー更新済み`, warnings.length > 0);
      $('metrics').textContent = `PNG描画バッファの計算値: 約${(result.plan.estimatedPixelBytes / 1024 ** 2).toFixed(1)} MiB。フォント・入力画像・PNG圧縮・ブラウザ内部の使用量は別です。`;
    } catch (error) {
      if (error.name !== 'AbortError') status(`描画できませんでした: ${error.message}`, true);
    }
  });
}

function field(form, slot, key, label, multiline = false, showKey = null) {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const header = document.createElement('div'); header.className = 'field-heading';
  const caption = document.createElement('label'); caption.textContent = label;
  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = 'text';
  input.id = `${slot.id}-${key}`; caption.htmlFor = input.id;
  input.value = slot.fields[key]; input.dataset.field = key; input.name = input.id;
  input.addEventListener('input', () => {
    const old = slot.fields[key]; let start = 0, end = old.length, nextEnd = input.value.length;
    while (start < end && start < nextEnd && old[start] === input.value[start]) start++;
    while (end > start && nextEnd > start && old[end - 1] === input.value[nextEnd - 1]) { end--; nextEnd--; }
    if (slot.typography?.[key]) slot.typography[key].kerns = replaceReview(old, slot.typography[key].kerns, start, end, input.value.slice(start, nextEnd)).kerns;
    slot.fields[key] = input.value; changed();
  });
  header.append(caption);
  if (showKey) {
    const toggle = document.createElement('label'); toggle.className = 'field-visibility';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = slot.show[showKey] !== false;
    checkbox.setAttribute('aria-label', `${label}を表示`);
    toggle.title = showKey === 'track' ? 'おすすめ曲番号と曲名を表示' : `${label}を表示`;
    checkbox.addEventListener('change', () => { slot.show[showKey] = checkbox.checked; changed(); });
    toggle.append(checkbox); header.append(toggle);
  }
  wrap.append(header, input); form.append(wrap); return input;
}

function percentField(form, label, value, min, max, explain, update) {
  const wrap = document.createElement('label'); wrap.className = 'field';
  const caption = document.createElement('span'); caption.textContent = label;
  const control = document.createElement('span'); control.className = 'unit-input';
  // Text inputs support selecting the complete signed decimal on double-click,
  // and displaying Mixed without inventing a numerical value.
  const input = document.createElement('input'); input.type = 'text'; input.inputMode = 'decimal';
  input.setAttribute('aria-label', label);
  const suffix = document.createElement('span'); suffix.className = 'unit-suffix';
  suffix.textContent = '%'; suffix.setAttribute('aria-hidden', 'true');
  const note = document.createElement('span'); note.className = 'hint unit-equivalent';
  const parsed = () => {
    const raw = input.value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
    const n = Number(raw); return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  function setValue(n) {
    input.value = n === null ? 'Mixed' : String(Number(n.toFixed(6)));
    suffix.hidden = n === null;
    note.textContent = n === null ? '複数の字間が混在しています' : explain(n);
    input.removeAttribute('aria-invalid');
  }
  setValue(value);
  input.addEventListener('focus', () => { if (input.value === 'Mixed') input.select(); });
  input.addEventListener('dblclick', () => input.select());
  input.addEventListener('input', () => {
    suffix.hidden = false;
    const n = parsed();
    if (n === null) {
      input.setAttribute('aria-invalid', 'true');
      note.textContent = `${min}〜${max}の数値を入力してください。`; return;
    }
    input.removeAttribute('aria-invalid'); note.textContent = explain(n); update(n);
  });
  control.append(input, suffix); wrap.append(caption, control, note); form.append(wrap);
  return { input, setValue };
}

function createFormatting(form, slot, review) {
  const sources = [...form.querySelectorAll('[data-field]')];
  const mirrors = new Map(sources.map(input => [input, selectionOverlay(input)]));
  let source = review?.input || sources[0];
  const panel = document.createElement('section'); panel.className = 'formatting-panel';
  const heading = document.createElement('h4'); panel.append(heading);
  const typography = document.createElement('div'); typography.className = 'typography-fields'; panel.append(typography);
  const labels = { title:'作品名', artist:'アーティスト名', duration:'曲数・総尺', genreMemo:'ジャンル', country:'国', trackNo:'おすすめ曲番号', track:'おすすめ曲名', text:'評価文' };
  const key = () => source.dataset.field;
  const range = () => source === review?.input ? review.getSelection() : [source.selectionStart || 0, source.selectionEnd || 0];
  function modify(edit) {
    if (source === review?.input) review.applyFormatting(edit);
    else { edit(); changed(); sync(); }
    for (const mirror of mirrors.values()) mirror.update();
  }
  const leading = percentField(typography, '行送りの上限', 150, 100, 300,
    n => `${Number((n / 100).toFixed(6))}em（文字枠全体）`, n => modify(() => {
      if (key() === 'text') { slot.bodyLeadMode = 'custom'; slot.bodyMaxLead = Number((n / 100 * Layout.TYPE.body.size).toFixed(6)); }
      else { fieldAdapter(slot, key()); slot.typography[key()].leading = n / 100; }
    }));
  const spacing = percentField(typography, '字間', 0, -20, 20,
    n => `${Number((n / 100).toFixed(6))}em`, n => modify(() => setSpacing(fieldAdapter(slot, key()), range(), n / 100)));
  const finish = document.createElement('button'); finish.type = 'button'; finish.textContent = '調整を確定'; panel.append(finish);
  const note = document.createElement('p'); note.className = 'hint';
  note.textContent = '選択中の文字は調整欄へ移動しても青く残ります。字間は選択範囲、行送りは文字枠全体に適用。Enter・確定ボタン・調整欄の外のクリックで選択を解除します。1行の文字では行送りを変えても見た目は変わりません。';
  panel.append(note); form.append(panel);
  function sync() {
    const [start, end] = range();
    heading.textContent = `調整対象：${labels[key()]}${end > start ? `（${start + 1}〜${end}文字）` : '（全体）'}`;
    if (document.activeElement !== spacing.input) {
      const value = spacingValue(fieldAdapter(slot, key()), range()); spacing.setValue(value === null ? null : value * 100);
    }
    if (document.activeElement !== leading.input) leading.setValue(key() === 'text' ? slot.bodyMaxLead / Layout.TYPE.body.size * 100 : (fieldType(slot, key()).leading ?? defaultLeading(key())) * 100);
    for (const mirror of mirrors.values()) mirror.update();
  }
  function clear() {
    if (source === review?.input) review.clearSelection();
    else { const end = source.selectionEnd || 0; source.setSelectionRange(end, end); }
    sync();
  }
  function focus(event) {
    if (source !== event.target) { clear(); source = event.target; }
    sync();
  }
  function sourceSelection() { if (document.activeElement === source) sync(); }
  function outside(event) {
    if (event.target !== source && !panel.contains(event.target)) clear();
  }
  for (const input of sources) {
    input.addEventListener('focus', focus);
    input.addEventListener('select', sourceSelection);
    input.addEventListener('keyup', sourceSelection);
  }
  review?.onSelectionChange(sync);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  finish.addEventListener('click', clear);
  for (const input of [leading.input, spacing.input]) {
    input.addEventListener('blur', sync);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); clear(); input.blur(); } });
  }
  sync();
  return { refresh: sync, destroy() {
    document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside);
    for (const [input, mirror] of mirrors) {
      mirror.destroy(); input.removeEventListener('focus', focus); input.removeEventListener('select', sourceSelection); input.removeEventListener('keyup', sourceSelection);
    }
    review?.onSelectionChange(() => {});
  } };
}

function buildForms() {
  const generation = restoreGeneration;
  for (const controller of formattingControllers) controller.destroy();
  formattingControllers = [];
  for (const editor of reviewEditors) editor.destroy();
  reviewEditors = [];
  $('forms').replaceChildren();
  const page = pages[mode];
  $('page-bg').value = page.bgColor;
  document.querySelector('.page-setting .hint').textContent = page.kind === 'listed'
    ? '上下のアルバムに共通する色は1つです。' : 'この画像全体の背景色です。';
  page.slots.forEach((slot, index) => {
    const detail = document.createElement('details');
    detail.className = 'album-form';
    detail.open = true;
    detail.dataset.itemId = slot.id;
    const summary = document.createElement('summary');
    summary.textContent = `${page.kind === 'listed' ? (index === 0 ? '上段' : '下段') : '採用'}アルバム`;
    detail.append(summary);
    const form = document.createElement('div');
    form.className = 'form-fields';
    field(form, slot, 'title', '作品名（改行できます）', true, 'title');
    field(form, slot, 'artist', 'アーティスト名', true, 'artist');
    const metadata = document.createElement('div');
    metadata.className = 'two-columns';
    field(metadata, slot, 'duration', '曲数・総尺', true, 'duration');
    field(metadata, slot, 'genreMemo', 'ジャンル', true, 'genreMemo');
    field(metadata, slot, 'country', '国', true, 'country');
    field(metadata, slot, 'trackNo', 'おすすめ曲番号', true);
    form.append(metadata);
    field(form, slot, 'track', 'おすすめ曲名', true, 'track');
    let editor;
    if (page.kind === 'adopted') {
      editor = createReviewEditor(form, slot, changed);
      reviewEditors.push(editor);
    }
    formattingControllers.push(createFormatting(form, slot, editor));
    const fileLabel = document.createElement('label');
    fileLabel.className = 'field file-field'; fileLabel.textContent = 'ジャケットを差し替え（PNG・JPEG・WebP）';
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg,image/webp';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0]; if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 ** 2) {
        status('PNG・JPEG・WebPの10MB以下の画像を選んでください。', true); return;
      }
      const sequence = (jacketRequests.get(slot) || 0) + 1;
      jacketRequests.set(slot, sequence);
      const url = URL.createObjectURL(file); localImageUrls.add(url);
      pendingImages++;
      try {
        const image = await loadImage(url);
        if (sequence !== jacketRequests.get(slot) || generation !== restoreGeneration) return;
        slot.jacket = { img: image, source: 'manual', file, error: null };
        changed();
      } catch { status('画像を読み込めませんでした。', true); }
      finally { pendingImages--; URL.revokeObjectURL(url); localImageUrls.delete(url); }
    });
    fileLabel.append(fileInput); form.append(fileLabel);
    detail.append(form); $('forms').append(detail);
  });
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  buildForms(); changed();
}));
$('page-bg').addEventListener('input', event => { pages[mode].bgColor = event.target.value; changed(); });
$('use-wave').addEventListener('change', changed);
$('output-size').addEventListener('change', event => { size = Number(event.target.value); changed(); });

$('prepare-png').addEventListener('click', async () => {
  if (!canvas || readyRevision !== revision || !exportAllowed) return;
  const atRevision = revision;
  $('prepare-png').disabled = true;
  try {
    const blob = await canvasBlob(canvas);
    if (atRevision !== revision) return;
    clearPNG();
    generated = new File([blob], `monthly_sample_${mode}_02.png`, { type: 'image/png' });
    generatedUrl = URL.createObjectURL(generated);
    const link = $('download-png');
    link.href = generatedUrl; link.download = generated.name; link.hidden = false;
    $('share-png').hidden = !(navigator.share && navigator.canShare?.({ files: [generated] }));
    $('export-status').textContent = 'PNGの準備ができました。共有またはダウンロードしてください。';
  } catch (error) { $('export-status').textContent = `PNGを作成できませんでした: ${error.message}`; }
  finally { $('prepare-png').disabled = readyRevision !== revision || !exportAllowed; }
});
$('share-png').addEventListener('click', async () => {
  if (!generated || readyRevision !== revision) return;
  try { await navigator.share({ files: [generated] }); $('export-status').textContent = '共有操作を終了しました。'; }
  catch (error) { $('export-status').textContent = error.name === 'AbortError' ? '共有を取り消しました。' : '共有できませんでした。PNGをダウンロードしてください。'; }
});
window.addEventListener('beforeunload', event => {
  if (pendingImages || restoring || draftPanel?.dirty || (!draftPanel && revision > 0)) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void draftPanel?.flush(); });
window.addEventListener('pagehide', () => {
  void draftPanel?.flush();
  controller?.abort();
  for (const url of localImageUrls) URL.revokeObjectURL(url);
});
window.addEventListener('pageshow', event => { if (event.persisted && ready) changed(false); });

buildForms();
// Recovery does not depend on the Google Fonts network request succeeding.
// Users can still save their edits if preview preparation fails/offline.
draftPanel = await createDraftPanel({
  capture: () => captureDraft(pages, { mode, size, useWave: $('use-wave').checked }),
  setBusy(busy) {
    restoring = busy;
    document.querySelector('nav').inert = busy;
    document.querySelector('main').inert = busy;
  },
  async restore(value) {
    if (pendingImages) throw new Error('ジャケットの読み込みが終わってから復元してください。');
    const restored = await restoreDraft(value, sampleImage || await loadImage('./assets/jacket_2000.webp'), async blob => {
      const url = URL.createObjectURL(blob);
      try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
    });
    restoreGeneration++;
    Object.assign(pages, restored.pages);
    mode = restored.mode; size = restored.size;
    $('use-wave').checked = restored.useWave; $('output-size').value = String(size);
    document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    buildForms(); changed(false);
  },
});
if (revision > 0) draftPanel.changed();
try {
  const [, jacket, wave] = await Promise.all([
    Fonts.loadAll(), loadImage('./assets/jacket_2000.webp'), loadImage('./assets/waves/wave2608.png'),
  ]);
  for (const page of Object.values(pages)) for (const slot of page.slots) {
    if (slot.jacket.source !== 'manual') slot.jacket.img = jacket;
  }
  images.wave = wave;
  sampleImage = jacket;
  ready = true; queueRender();
} catch (error) { status(`準備できませんでした: ${error.message}`, true); }
