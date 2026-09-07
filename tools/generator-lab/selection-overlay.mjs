// Native textarea selection becomes invisible when a number field takes focus.
// Mirror only the highlight; the real input remains the sole editable surface.
export function selectionOverlay(input) {
  const host = document.createElement('span'); host.className = 'selection-host';
  input.replaceWith(host); host.append(input);
  const overlay = document.createElement('span'); overlay.className = 'selection-overlay';
  overlay.setAttribute('aria-hidden', 'true'); host.append(overlay);
  const inner = document.createElement('span'); inner.className = 'selection-ink'; overlay.append(inner);
  function update() {
    const start = input.selectionStart ?? 0, end = input.selectionEnd ?? 0;
    overlay.hidden = start === end || document.activeElement === input;
    if (overlay.hidden) return;
    const style = getComputedStyle(input);
    for (const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing',
      'textAlign','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','boxSizing']) inner.style[key] = style[key];
    inner.style.whiteSpace = input.tagName === 'TEXTAREA' && input.wrap !== 'off' ? 'pre-wrap' : 'pre';
    inner.style.overflowWrap = style.overflowWrap;
    inner.style.width = `${input.offsetWidth}px`;
    inner.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    const mark = document.createElement('mark'); mark.textContent = input.value.slice(start, end);
    inner.replaceChildren(document.createTextNode(input.value.slice(0, start)), mark,
      document.createTextNode(input.value.slice(end)));
  }
  for (const type of ['select','focus','blur','scroll','input']) input.addEventListener(type, update);
  const resize = new ResizeObserver(update); resize.observe(input);
  return { update, destroy: () => {
    resize.disconnect();
    for (const type of ['select','focus','blur','scroll','input']) input.removeEventListener(type, update);
  } };
}
