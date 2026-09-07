import Layout from './layout.mjs';

export function defaultLeading(key) {
  return key === 'title' ? Layout.TEXT.titleLead / Layout.TYPE.title.size : key === 'text' ? 1.5 : 1.2;
}

export function fieldType(slot, key) {
  return slot.typography?.[key] || { tracking: 0, kerns: {}, leading: defaultLeading(key) };
}

export function fieldAdapter(slot, key) {
  if (key === 'text') return slot;
  slot.typography ??= {};
  slot.typography[key] ??= { tracking: 0, kerns: {}, leading: defaultLeading(key) };
  const state = slot.typography[key];
  return { fields: { get text() { return slot.fields[key]; } },
    get tracking() { return state.tracking; }, set tracking(value) { state.tracking = value; },
    get kerns() { return state.kerns; }, set kerns(value) { state.kerns = value; } };
}
