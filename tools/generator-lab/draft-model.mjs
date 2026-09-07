// Versioned LOCAL recovery format. Not a server save or an API input schema.
// Keep DOM/Image/URL objects out of the document; image bytes travel separately.
export const DRAFT_SCOPE = 'generator-lab:sample-v1';
export const DRAFT_VERSION = 1;
const fields = ['title', 'artist', 'duration', 'genreMemo', 'country', 'trackNo', 'track', 'text'];
const showKeys = ['title', 'artist', 'duration', 'genreMemo', 'country', 'track'];
const modes = ['listed', 'adopted'];
const fail = () => { throw new Error('下書きの形式が不正、または未対応です。保存データは変更していません。'); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const identifier = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function textFields(value) {
  if (!object(value)) fail();
  return Object.fromEntries(fields.map(key => {
    if (typeof value[key] !== 'string' || value[key].length > 20000) fail();
    return [key, value[key]];
  }));
}

function kerns(value, text, tracking) {
  if (!object(value)) fail();
  return Object.fromEntries(Object.entries(value).map(([key, delta]) => {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= text.length || !finite(delta, -.4, .4)
      || !finite(Number((tracking + delta).toFixed(6)), -.2, .2)) fail();
    return [key, delta];
  }));
}

function item(value) {
  if (!object(value) || !identifier(value.id)) fail();
  const values = textFields(value.fields);
  if (!object(value.show) || !finite(value.tracking, -.2, .2) || !finite(value.bodyMaxLead, 28, 84)
    || (value.bodyLeadMode !== undefined && !['auto', 'custom'].includes(value.bodyLeadMode))) fail();
  const show = Object.fromEntries(showKeys.map(key => {
    if (typeof value.show[key] !== 'boolean') fail();
    return [key, value.show[key]];
  }));
  if (!object(value.typography)) fail();
  const typography = Object.fromEntries(Object.entries(value.typography).map(([key, type]) => {
    if (!fields.includes(key) || key === 'text' || !object(type)
      || !finite(type.tracking, -.2, .2) || !finite(type.leading, 1, 3)) fail();
    return [key, { tracking: type.tracking, leading: type.leading, kerns: kerns(type.kerns, values[key], type.tracking) }];
  }));
  if (value.jacket !== 'sample' && value.jacket !== 'manual') fail();
  return { id: value.id, fields: values, show, tracking: value.tracking,
    kerns: kerns(value.kerns, values.text, value.tracking), bodyLeadMode: value.bodyLeadMode || 'auto', bodyMaxLead: value.bodyMaxLead,
    typography, jacket: value.jacket };
}

export function validateDraft(value) {
  if (!object(value) || value.schemaVersion !== DRAFT_VERSION || value.scope !== DRAFT_SCOPE
    || !object(value.pages) || !object(value.theme) || !object(value.ui)
    || typeof value.theme.useWave !== 'boolean' || ![1200, 2400].includes(value.theme.outputSize)
    || !modes.includes(value.ui.mode)) fail();
  const ids = new Set();
  const pages = Object.fromEntries(modes.map(mode => {
    const page = value.pages[mode];
    if (!object(page) || !identifier(page.id) || ids.has(page.id) || page.kind !== mode
      || !Number.isInteger(page.no) || page.no < 2 || !color(page.bgColor)
      || !Array.isArray(page.slots) || page.slots.length < 1
      || page.slots.length > (mode === 'listed' ? 2 : 1)) fail();
    ids.add(page.id);
    const slots = page.slots.map(raw => {
      const slot = item(raw);
      if (ids.has(slot.id)) fail();
      ids.add(slot.id); return slot;
    });
    return [mode, { id: page.id, kind: mode, no: page.no, bgColor: page.bgColor, slots }];
  }));
  return { schemaVersion: DRAFT_VERSION, scope: DRAFT_SCOPE, pages,
    theme: { useWave: value.theme.useWave, outputSize: value.theme.outputSize }, ui: { mode: value.ui.mode } };
}

export function captureDraft(pages, { mode, size, useWave }) {
  const assets = {};
  const snapshots = Object.fromEntries(modes.map(key => [key, { ...pages[key], slots: pages[key].slots.map(slot => {
    const manual = slot.jacket.source === 'manual';
    if (manual) assets[slot.id] = slot.jacket.file;
    return { id: slot.id, fields: slot.fields, show: slot.show,
      tracking: slot.tracking, kerns: slot.kerns, bodyLeadMode: slot.bodyLeadMode || 'auto', bodyMaxLead: slot.bodyMaxLead,
      typography: slot.typography || {}, jacket: manual ? 'manual' : 'sample' };
  }) }]));
  return validatePackage({ document: { schemaVersion: DRAFT_VERSION, scope: DRAFT_SCOPE,
    pages: snapshots, theme: { outputSize: size, useWave }, ui: { mode } }, assets });
}

export function validatePackage(value) {
  if (!object(value) || !object(value.assets)) fail();
  const document = validateDraft(value.document);
  const assets = {};
  for (const page of Object.values(document.pages)) for (const slot of page.slots) {
    if (slot.jacket !== 'manual') continue;
    const blob = value.assets[slot.id];
    if (!(blob instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)
      || blob.size === 0 || blob.size > 10 * 1024 ** 2) fail();
    assets[slot.id] = blob;
  }
  return { document, assets };
}

export async function restoreDraft(value, sampleImage, decode) {
  const { document, assets } = validatePackage(value);
  // Decode everything before returning; a missing/corrupt image must not partly
  // replace the editor or silently fall back to the sample jacket.
  const decoded = new Map();
  for (const [id, blob] of Object.entries(assets)) decoded.set(id, await decode(blob));
  return { pages: Object.fromEntries(Object.entries(document.pages).map(([key, page]) => [key,
    { ...page, slots: page.slots.map(slot => ({ ...slot, jacket: slot.jacket === 'manual'
      ? { source: 'manual', img: decoded.get(slot.id), file: assets[slot.id], error: null }
      : { source: 'sample', img: sampleImage, error: null } })) }])),
  mode: document.ui.mode, size: document.theme.outputSize, useWave: document.theme.useWave };
}
