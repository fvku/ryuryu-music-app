// A soft line break exists only in the editor view, never in the source text.
export function projectReview(text, lines) {
  const breaks = new Set(lines.filter(line => !line.paragraphEnd).map(line => line.end));
  let display = '';
  const toSource = [0];
  for (let i = 0; i <= text.length; i++) {
    if (breaks.has(i)) { display += '\n'; toSource.push(i); }
    if (i < text.length) { display += text[i]; toSource.push(i + 1); }
  }
  return { text, display, toSource };
}

export function displayOffset(projection, sourceOffset) {
  return Math.max(0, projection.toSource.lastIndexOf(sourceOffset));
}

export function projectedEdit(projection, nextDisplay) {
  const old = projection.display;
  let start = 0;
  while (start < old.length && start < nextDisplay.length && old[start] === nextDisplay[start]) start++;
  let end = old.length, nextEnd = nextDisplay.length;
  while (end > start && nextEnd > start && old[end - 1] === nextDisplay[nextEnd - 1]) { end--; nextEnd--; }
  return { start: projection.toSource[start], end: projection.toSource[end],
    inserted: nextDisplay.slice(start, nextEnd), displayStart: start, displayEnd: nextEnd };
}

export function replaceReview(text, kerns, start, end, inserted) {
  const nextKerns = {};
  const shift = inserted.length - (end - start);
  for (const [key, value] of Object.entries(kerns)) {
    const index = Number(key);
    if (index < start) nextKerns[index] = value;
    else if (index >= end) nextKerns[index + shift] = value;
  }
  return { text: text.slice(0, start) + inserted + text.slice(end), kerns: nextKerns };
}

export function adjacentGrapheme(text, offset, direction) {
  const boundaries = [0, ...[...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)]
    .map(part => part.index + part.segment.length)];
  return direction < 0 ? (boundaries.filter(n => n < offset).at(-1) ?? 0)
    : (boundaries.find(n => n > offset) ?? text.length);
}
