import { GeneratorError } from "./errors";

export const FIELD_KEYS = ["title", "artist", "duration", "genreMemo", "country", "trackNo", "track", "text"] as const;
export const SHOW_KEYS = ["title", "artist", "duration", "genreMemo", "country", "track"] as const;
export type Fields = Record<typeof FIELD_KEYS[number], string>;
export type Typography = { tracking: number; kerns: Record<string, number>; leading: number };
export type ItemContent = {
  fields: Fields;
  show: Record<typeof SHOW_KEYS[number], boolean>;
  tracking: number;
  kerns: Record<string, number>;
  bodyLeadMode: "auto" | "custom";
  bodyMaxLead: number;
  typography: Partial<Record<Exclude<typeof FIELD_KEYS[number], "text">, Typography>>;
  jacketAssetId: string | null;
};
export type GeneratorItemSource = {
  kind: "manual" | "release-master";
  uid: string | null;
  no: string | null;
  date: string;
  importedAt: string | null;
  coverUrl: string | null;
  fields: Fields;
};
export type GeneratorItem = {
  id: string;
  source: GeneratorItemSource;
  content: ItemContent;
};
export type GeneratorPage = { id: string; kind: "adopted" | "listed" | "cover" | "feature" | "others"; itemIds: string[]; bgColor: string | null };
export type GeneratorTheme = { useWave: boolean; waveAssetId: string | null; backgroundAssetId: string | null; outputSize: 1200 | 2400 };
export type GeneratorDocument = {
  schemaVersion: 1;
  id: string;
  series: "monthly" | "japan" | "weekly";
  period: { type: "month" | "week"; start: string; end: string; weekNumber?: number };
  rendererVersion: "monthly-japan-v1" | "weekly-v1";
  pages: GeneratorPage[];
  theme: GeneratorTheme;
  items: GeneratorItem[];
};

function invalid(): never { throw new GeneratorError("INVALID_INPUT", 400, "保存データの形式・参照・範囲が不正です。"); }
export function record(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const result = value as Record<string, unknown>;
  if (allowed && Object.keys(result).some((key) => !allowed.includes(key))) invalid();
  return result;
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid();
  return value.toLowerCase();
}
function string(value: unknown, max = 20000): string {
  if (typeof value !== "string" || value.length > max) invalid(); return value;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid(); return value;
}
function bool(value: unknown): boolean { if (typeof value !== "boolean") invalid(); return value; }
function nullableId(value: unknown): string | null { return value === null ? null : uuid(value); }
function fields(value: unknown): Fields {
  const raw = record(value, FIELD_KEYS);
  return Object.fromEntries(FIELD_KEYS.map((key) => [key, string(raw[key])])) as Fields;
}
function kerns(value: unknown, text: string, tracking: number): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, raw]) => {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= text.length) invalid();
    const delta = number(raw, -.4, .4);
    number(Number((tracking + delta).toFixed(6)), -.2, .2);
    return [key, delta];
  }));
}
export function parseItemSource(value: unknown): GeneratorItemSource {
  const source = record(value, ["kind", "uid", "no", "date", "importedAt", "coverUrl", "fields"]);
  if (source.kind !== "manual" && source.kind !== "release-master") invalid();
  const uid = source.uid === null ? null : string(source.uid, 200);
  if (uid !== null && !uid.trim()) invalid();
  const importedAt = source.importedAt === null ? null : string(source.importedAt, 30);
  if (importedAt !== null && (!Number.isFinite(Date.parse(importedAt)) || new Date(importedAt).toISOString() !== importedAt)) invalid();
  const coverUrl = source.coverUrl === undefined || source.coverUrl === null ? null : string(source.coverUrl, 2000);
  if (coverUrl !== null) {
    let parsed: URL;
    try { parsed = new URL(coverUrl); } catch { invalid(); }
    if (parsed.protocol !== "https:") invalid();
  }
  return {
    kind: source.kind,
    uid,
    no: source.no === null ? null : string(source.no, 100),
    date: string(source.date, 100),
    importedAt,
    coverUrl,
    fields: fields(source.fields),
  };
}
export function parseItemContent(value: unknown): ItemContent {
  const raw = record(value, ["fields", "show", "tracking", "kerns", "bodyLeadMode", "bodyMaxLead", "typography", "jacketAssetId"]);
  const text = fields(raw.fields), visibility = record(raw.show, SHOW_KEYS), tracking = number(raw.tracking, -.2, .2);
  const bodyLeadMode = raw.bodyLeadMode === undefined ? "auto" : raw.bodyLeadMode;
  if (bodyLeadMode !== "auto" && bodyLeadMode !== "custom") invalid();
  const typography = Object.fromEntries(Object.entries(record(raw.typography, FIELD_KEYS.filter(key => key !== "text"))).map(([key, value]) => {
    const raw = record(value, ["tracking", "kerns", "leading"]), tracking = number(raw.tracking, -.2, .2);
    return [key, { tracking, leading: number(raw.leading, 1, 3), kerns: kerns(raw.kerns, text[key as keyof Fields], tracking) }];
  }));
  return { fields: text, show: Object.fromEntries(SHOW_KEYS.map(key => [key, bool(visibility[key])])) as ItemContent["show"],
    tracking, kerns: kerns(raw.kerns, text.text, tracking), bodyLeadMode, bodyMaxLead: number(raw.bodyMaxLead, 28, 84), typography,
    jacketAssetId: nullableId(raw.jacketAssetId) };
}
function date(value: unknown): string {
  const result = string(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) invalid();
  return result;
}
export function parseTheme(value: unknown): GeneratorTheme {
  const raw = record(value, ["useWave", "waveAssetId", "backgroundAssetId", "outputSize"]);
  if (raw.outputSize !== 1200 && raw.outputSize !== 2400) invalid();
  return { useWave: bool(raw.useWave), waveAssetId: nullableId(raw.waveAssetId), backgroundAssetId: nullableId(raw.backgroundAssetId), outputSize: raw.outputSize };
}
export function parseColor(value: unknown): string | null {
  if (value === null) return null;
  const result = string(value, 7); if (!/^#[0-9a-f]{6}$/i.test(result)) invalid(); return result.toLowerCase();
}
export function parseDocument(value: unknown): GeneratorDocument {
  const raw = record(value, ["schemaVersion", "id", "series", "period", "rendererVersion", "pages", "theme", "items"]);
  if (raw.schemaVersion !== 1 || typeof raw.series !== "string" || !["monthly", "japan", "weekly"].includes(raw.series)) invalid();
  const series = raw.series as GeneratorDocument["series"], period = record(raw.period, ["type", "start", "end", "weekNumber"]);
  const start = date(period.start), end = date(period.end);
  let weekNumber: number | undefined;
  if (end <= start) invalid();
  if (series === "weekly") {
    if (period.type !== "week" || Date.parse(end) - Date.parse(start) !== 7 * 86400000 || raw.rendererVersion !== "weekly-v1") invalid();
    weekNumber = number(period.weekNumber, 1, 53);
    if (!Number.isInteger(weekNumber)) invalid();
  } else {
    const next = new Date(start); next.setUTCMonth(next.getUTCMonth() + 1);
    if (period.type !== "month" || period.weekNumber !== undefined || !start.endsWith("-01") || next.toISOString().slice(0, 10) !== end || raw.rendererVersion !== "monthly-japan-v1") invalid();
  }
  if (!Array.isArray(raw.items) || raw.items.length > 200 || !Array.isArray(raw.pages) || raw.pages.length > 200) invalid();
  const itemIds = new Set<string>(), sourceUids = new Set<string>();
  const items = raw.items.map(value => {
    const raw = record(value, ["id", "source", "content"]), id = uuid(raw.id);
    if (itemIds.has(id)) invalid(); itemIds.add(id);
    const source = parseItemSource(raw.source), uid = source.uid;
    if (uid !== null) { if (!uid.trim() || sourceUids.has(uid)) invalid(); sourceUids.add(uid); }
    return { id, source, content: parseItemContent(raw.content) } as GeneratorItem;
  });
  const pageIds = new Set<string>(), placed = new Set<string>();
  let listed = false, weeklyStage: "cover" | "feature" | "others" = "cover", featureCount = 0, coverCount = 0, othersCount = 0;
  const pages = raw.pages.map(value => {
    const raw = record(value, ["id", "kind", "itemIds", "bgColor"]), id = uuid(raw.id);
    if (pageIds.has(id) || !Array.isArray(raw.itemIds) || typeof raw.kind !== "string") invalid();
    pageIds.add(id);
    if (series === "weekly") {
      if (!["cover", "feature", "others"].includes(raw.kind)) invalid();
      if (raw.kind === "cover") {
        if (weeklyStage !== "cover" || coverCount || raw.itemIds.length !== 0) invalid();
        coverCount += 1; weeklyStage = "feature";
      } else if (raw.kind === "feature") {
        if (weeklyStage !== "feature" || featureCount >= 5 || raw.itemIds.length !== 1) invalid();
        featureCount += 1;
      } else {
        if (weeklyStage !== "feature" || othersCount || raw.itemIds.length > 60) invalid();
        othersCount += 1; weeklyStage = "others";
      }
    } else {
      if (!["adopted", "listed"].includes(raw.kind)) invalid();
      if (listed && raw.kind === "adopted") invalid();
      listed ||= raw.kind === "listed";
      if (raw.itemIds.length < 1 || raw.itemIds.length > (raw.kind === "adopted" ? 1 : 2)) invalid();
    }
    const ids = raw.itemIds.map(value => { const id = uuid(value); if (!itemIds.has(id) || placed.has(id)) invalid(); placed.add(id); return id; });
    return { id, kind: raw.kind as GeneratorPage["kind"], itemIds: ids, bgColor: parseColor(raw.bgColor) };
  });
  if (series === "weekly" && (coverCount !== 1 || othersCount !== 1)) invalid();
  if (placed.size !== items.length) invalid();
  return { schemaVersion: 1, id: uuid(raw.id), series, period: { type: series === "weekly" ? "week" : "month", start, end, ...(weekNumber === undefined ? {} : { weekNumber }) },
    rendererVersion: series === "weekly" ? "weekly-v1" : "monthly-japan-v1", pages, theme: parseTheme(raw.theme), items };
}
