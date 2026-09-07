import Layout from './core/layout.mjs';
import Render from './core/render.mjs';
import { projectReview, projectedEdit, displayOffset, replaceReview, adjacentGrapheme } from './review-projection.mjs';

export function createReviewEditor(form, slot, changed) {
  const section = document.createElement('section'); section.className = 'review-editor';
  const heading = document.createElement('h3'); heading.textContent = '評価文';
  const hint = document.createElement('p'); hint.className = 'hint';
  hint.textContent = '画像と同じ改行位置を保ち、全文が幅に収まるよう表示サイズを自動調整します。自動折り返しは原稿に保存されません。';
  const scroll = document.createElement('div'); scroll.className = 'review-scroll';
  const inner = document.createElement('div'); inner.className = 'review-inner';
  const label = document.createElement('label'); label.className = 'field';
  label.textContent = '評価文（プレビューと同じ改行）';
  const input = document.createElement('textarea'); input.wrap = 'off'; input.spellcheck = false;
  input.dataset.field = 'text'; input.className = 'review-input'; input.disabled = true;
  input.setAttribute('aria-describedby', `${slot.id}-review-status`);
  label.append(input);
  const caption = document.createElement('p'); caption.className = 'hint'; caption.textContent = '文字位置の拡大表示（出力画像と共通）';
  const crop = document.createElement('canvas'); crop.className = 'review-crop';
  crop.width = 1100; crop.height = 454; crop.setAttribute('aria-label', '評価文の文字位置の拡大表示');
  inner.append(caption, crop, label); scroll.append(inner);
  const info = document.createElement('p'); info.className = 'hint'; info.id = `${slot.id}-review-status`;
  section.append(heading, hint, scroll, info); form.append(section);
  const measure = document.createElement('canvas');
  const ctx = measure.getContext('2d');
  let projection = projectReview(slot.fields.text, []);
  input.value = projection.display;
  let composing = false;
  let selection = [0, 0];
  let selectionChanged = () => {};
  const undo = [], redo = [];

  function fitText() {
    if (composing || !input.clientWidth) return;
    const style = getComputedStyle(input);
    const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 4;
    ctx.font = '370 18px "Noto Sans JP"';
    const longest = Math.max(1, ...input.value.split('\n').map(line =>
      ctx.measureText(line).width + Math.max(0, [...line].length - 1) * (slot.tracking || 0) * 18));
    let fontSize = Math.min(18, 18 * available / longest);
    input.style.fontSize = `${fontSize}px`;
    // Check native textarea metrics as well: font rounding and shaping differ
    // slightly from Canvas measurement. Fit the content, never crop it.
    for (let i = 0; i < 3 && input.scrollWidth > input.clientWidth; i++) {
      fontSize *= available / (input.scrollWidth - input.clientWidth + available + 2);
      input.style.fontSize = `${fontSize}px`;
    }
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 2}px`;
  }
  let lastWidth = 0;
  const resize = new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width !== lastWidth) { lastWidth = width; fitText(); }
  });
  resize.observe(inner);

  function capture() {
    if (composing || document.activeElement !== input) return;
    const next = [projection.toSource[input.selectionStart], projection.toSource[input.selectionEnd]];
    if (next.some(n => n === undefined)) return;
    if (next[0] !== selection[0] || next[1] !== selection[1]) {
      selection = next;
      selectionChanged();
    }
  }
  function refresh(sourceCanvas, outputSize) {
    if (composing) return;
    const active = document.activeElement === input;
    if (active) capture();
    const lines = Render.bodyLines(ctx, slot.fields.text, slot.tracking, slot.kerns);
    projection = projectReview(slot.fields.text, lines);
    input.value = projection.display;
    input.disabled = false;
    const automatic = slot.bodyLeadMode !== 'custom';
    const { lead } = Layout.bodyLayoutFor(lines.length, automatic ? undefined : slot.bodyMaxLead);
    input.style.lineHeight = String(Math.max(1.1, lead / Layout.TYPE.body.size || 1.5));
    input.style.letterSpacing = `${slot.tracking || 0}em`;
    input.rows = Math.max(3, lines.length);
    input.dataset.lineCount = String(lines.length);
    fitText();
    info.textContent = `${lines.length}行 · 行送り ${lead.toFixed(1)}px / ${automatic ? '天地25pxに合わせて自動' : `上限 ${Number((slot.bodyMaxLead ?? Layout.TEXT.bodyMaxLead).toFixed(3))}px`}（1200px基準）${Layout.bodyFits(lines.length) ? '' : ' · 本文が多すぎます。文字量を減らしてください。'}`;
    info.classList.toggle('error', !Layout.bodyFits(lines.length));
    input.setSelectionRange(displayOffset(projection, selection[0]), displayOffset(projection, selection[1]));
    selectionChanged();
    if (sourceCanvas) {
      const scale = outputSize / Layout.CANVAS;
      const cell = Layout.CELLS.body;
      crop.getContext('2d').drawImage(sourceCanvas, cell.x * scale, cell.y * scale,
        cell.w * scale, cell.h * scale, 0, 0, crop.width, crop.height);
      crop.removeAttribute('aria-busy');
    }
  }
  function savePoint() {
    undo.push({ text: slot.fields.text, tracking: slot.tracking, kerns: { ...slot.kerns }, selection: [...selection] });
    if (undo.length > 100) undo.shift();
    redo.length = 0;
  }
  function apply(edit, caret) {
    savePoint();
    const next = replaceReview(slot.fields.text, slot.kerns, edit.start, edit.end, edit.inserted);
    slot.fields.text = next.text; slot.kerns = next.kerns;
    selection = [caret, caret];
    // Rebuild only after the native input/IME has completed. Preserve source
    // offsets rather than cursor positions in the temporary soft-break view.
    projection = projectReview(slot.fields.text, []);
    input.value = projection.display;
    input.setSelectionRange(caret, caret);
    refresh(); crop.setAttribute('aria-busy', 'true'); changed();
  }
  function commit() {
    if (composing || input.value === projection.display) return;
    const edit = projectedEdit(projection, input.value);
    const caret = edit.start + edit.inserted.length;
    apply(edit, caret);
  }
  function travel(from, to) {
    if (!from.length || composing) return;
    to.push({ text: slot.fields.text, tracking: slot.tracking, kerns: { ...slot.kerns }, selection: [...selection] });
    const point = from.pop(); slot.fields.text = point.text; slot.kerns = point.kerns;
    slot.tracking = point.tracking;
    projection = projectReview(point.text, []); input.value = point.text;
    selection = point.selection; input.setSelectionRange(...selection);
    refresh(); crop.setAttribute('aria-busy', 'true'); changed();
  }
  input.addEventListener('beforeinput', event => {
    if (composing || event.isComposing) return;
    capture();
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault();
      if (event.inputType === 'historyUndo') travel(undo, redo); else travel(redo, undo);
      return;
    }
    const backward = event.inputType === 'deleteContentBackward';
    const forward = event.inputType === 'deleteContentForward';
    if (!(backward || forward) || input.selectionStart !== input.selectionEnd) return;
    const p = input.selectionStart, raw = projection.toSource[p];
    const soft = backward ? projection.toSource[p - 1] === raw : projection.toSource[p + 1] === raw;
    if (!soft) return;
    event.preventDefault();
    const neighbor = adjacentGrapheme(slot.fields.text, raw, backward ? -1 : 1);
    const start = Math.min(raw, neighbor), end = Math.max(raw, neighbor);
    apply({ start, end, inserted: '' }, start);
  });
  input.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !composing) {
      event.preventDefault(); capture();
      if (event.shiftKey) travel(redo, undo); else travel(undo, redo);
    }
  });
  input.addEventListener('compositionstart', () => { capture(); composing = true; });
  input.addEventListener('compositionend', () => { composing = false; commit(); });
  input.addEventListener('input', commit);
  for (const type of ['copy', 'cut']) input.addEventListener(type, event => {
    if (composing || !event.clipboardData) return;
    capture(); const [start, end] = selection;
    if (end <= start) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', slot.fields.text.slice(start, end));
    if (type === 'cut') apply({ start, end, inserted: '' }, start);
  });
  for (const event of ['select', 'keyup', 'click', 'touchend']) input.addEventListener(event, capture);
  return { input, refresh, getSelection: () => [...selection],
    clearSelection: () => {
      selection = [selection[1], selection[1]];
      const end = displayOffset(projection, selection[1]); input.setSelectionRange(end, end);
      selectionChanged();
    },
    onSelectionChange: listener => { selectionChanged = listener; },
    applyFormatting: edit => { savePoint(); edit(); refresh(); crop.setAttribute('aria-busy', 'true'); changed(); },
    destroy: () => { resize.disconnect(); crop.width = crop.height = measure.width = measure.height = 0; } };
}
