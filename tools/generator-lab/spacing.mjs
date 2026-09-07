const rounded = n => Number(n.toFixed(6));

export function spacingRange(slot, selection) {
  const [start, end] = selection;
  return end > start ? [start, end] : [0, slot.fields.text.length];
}

export function spacingValue(slot, selection) {
  const [start, end] = spacingRange(slot, selection);
  let value;
  for (let i = start; i < end; i++) {
    if (slot.fields.text[i] === '\n') continue;
    const current = rounded((slot.tracking || 0) + (slot.kerns[i] || 0));
    if (value !== undefined && value !== current) return null;
    value = current;
  }
  return value ?? slot.tracking ?? 0;
}

export function setSpacing(slot, selection, value) {
  const [start, end] = spacingRange(slot, selection);
  if (start === 0 && end === slot.fields.text.length) {
    slot.tracking = value;
    slot.kerns = {};
    return;
  }
  for (let i = start; i < end; i++) {
    if (slot.fields.text[i] === '\n') continue;
    const delta = rounded(value - (slot.tracking || 0));
    if (delta === 0) delete slot.kerns[i]; else slot.kerns[i] = delta;
  }
}
