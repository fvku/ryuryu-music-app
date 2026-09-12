import { randomUUID } from "node:crypto";
import type { ReleaseMasterAlbum } from "../types";
import { GeneratorError } from "./errors";
import { parseDocument, type GeneratorDocument, type GeneratorItem } from "./model";

export type GeneratorSeries = GeneratorDocument["series"];
export type MonthlyGeneratorSeries = Exclude<GeneratorSeries, "weekly">;
const adoption = { monthly: { adopted: "採用", listed: "掲載" }, japan: { adopted: "J採用", listed: "J掲載" } } as const;
const ep = /^\s*[\[［]\s*ep\s*[\]］]\s*/i;
const DAY_MS = 86400000;

function yearMonth(value: string): string {
  const match = value.match(/(\d{4})\D+(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : "";
}
function dateKey(value: string): number {
  const match = value.match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
  return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3] || 0) : Number.MAX_SAFE_INTEGER;
}
function byArtist(a: ReleaseMasterAlbum, b: ReleaseMasterAlbum): number {
  const left = a.artist.trim().toLowerCase(), right = b.artist.trim().toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}
export function sortAlbums(albums: ReleaseMasterAlbum[]): ReleaseMasterAlbum[] {
  return albums.slice().sort((a, b) => Number(ep.test(a.title)) - Number(ep.test(b.title)) || dateKey(a.date) - dateKey(b.date)
    || byArtist(a, b));
}
/** 洋邦の並び順。空欄・想定外の値は末尾へ置き、取りこぼしに気づけるようにする。 */
function genreRank(album: ReleaseMasterAlbum): number {
  return album.genre === "洋楽" ? 0 : album.genre === "邦楽" ? 1 : 2;
}
/**
 * Other Releasesの並び（Koheiの指示、2026-09-11）。
 * アルバム（洋楽 → 邦楽）→ EP（洋楽 → 邦楽）の順で、各区分の中はアーティスト名のa-z順。
 * 実運用のEPは邦楽なので、見た目は「洋楽アルバム → 邦楽アルバム → 邦楽EP」になる。
 * 日付は見ない（発売日でメインとOther Releasesの並びが揺れるのを避ける）。
 * アーティスト名は小文字にしてコードポイント比較するため、記号・数字が先、和文はA-Zの後になる。
 */
export function sortWeeklyOthers(albums: ReleaseMasterAlbum[]): ReleaseMasterAlbum[] {
  return albums.slice().sort((a, b) => Number(ep.test(a.title)) - Number(ep.test(b.title))
    || genreRank(a) - genreRank(b) || byArtist(a, b));
}
function calendarDate(value: string): string | null {
  const match = value.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return null;
  const result = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : null;
}
function strictDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
}
function albumKey(album: ReleaseMasterAlbum): string {
  return `${album.title.trim().toLowerCase()}::${album.artist.trim().toLowerCase()}`;
}
export function parseImportPeriod(value: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new GeneratorError("INVALID_INPUT", 400, "対象月はYYYY-MM形式で指定してください。");
  const [year, month] = value.split("-").map(Number);
  const start = `${value}-01`, endDate = new Date(Date.UTC(year, month, 1));
  return { start, end: endDate.toISOString().slice(0, 10) };
}
export function parseWeeklyImportPeriod(value: string): { start: string; end: string } {
  const startDate = strictDate(value);
  if (!startDate || startDate.getUTCDay() !== 5) throw new GeneratorError("INVALID_INPUT", 400, "対象週は金曜日のYYYY-MM-DD形式で指定してください。");
  const endDate = new Date(startDate); endDate.setUTCDate(endDate.getUTCDate() + 7);
  return { start: value, end: endDate.toISOString().slice(0, 10) };
}
function weeklyReleaseWindow(value: string): { start: string; end: string } {
  const period = parseWeeklyImportPeriod(value);
  const saturday = strictDate(period.start)!;
  saturday.setUTCDate(saturday.getUTCDate() - 6);
  const nextSaturday = new Date(saturday);
  nextSaturday.setUTCDate(nextSaturday.getUTCDate() + 7);
  return { start: saturday.toISOString().slice(0, 10), end: nextSaturday.toISOString().slice(0, 10) };
}
export function isoWeek(value: string): { year: number; week: number } {
  const source = strictDate(value);
  if (!source) throw new GeneratorError("INVALID_INPUT", 400, "日付はYYYY-MM-DD形式で指定してください。");
  const thursday = new Date(source), day = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const year = thursday.getUTCFullYear(), yearStart = new Date(Date.UTC(year, 0, 1));
  return { year, week: Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7) };
}
export function selectReleaseMasterAlbums(albums: ReleaseMasterAlbum[], series: MonthlyGeneratorSeries, month: string) {
  const values = adoption[series];
  const deduped = new Map<string, ReleaseMasterAlbum>();
  for (const album of albums) {
    if (yearMonth(album.date) !== month || (album.mjAdoption !== values.adopted && album.mjAdoption !== values.listed)) continue;
    const key = albumKey(album);
    if (!deduped.has(key)) deduped.set(key, album);
  }
  const selected = [...deduped.values()];
  return { adopted: sortAlbums(selected.filter(album => album.mjAdoption === values.adopted)),
    listed: sortAlbums(selected.filter(album => album.mjAdoption === values.listed)) };
}
export function selectWeeklyAlbums(albums: ReleaseMasterAlbum[], week: string) {
  const period = weeklyReleaseWindow(week), deduped = new Map<string, ReleaseMasterAlbum>();
  const weekNumbers = new Set<string>();
  for (const album of albums) {
    const date = calendarDate(album.date);
    if (!date || date < period.start || date >= period.end
      || (album.weekAdoption !== "採用" && album.weekAdoption !== "掲載")) continue;
    const weekNumber = album.weekNumber.trim();
    if (!/^(?:[1-9]|[1-4]\d|5[0-3])$/.test(weekNumber)) {
      throw new GeneratorError("INVALID_INPUT", 400, "対象週のWEEK=採用／掲載行に正しい#（1〜53）を入力してください。");
    }
    weekNumbers.add(weekNumber);
    const key = albumKey(album);
    if (!deduped.has(key)) deduped.set(key, album);
  }
  if (weekNumbers.size > 1) throw new GeneratorError("INVALID_INPUT", 400, "対象の土曜〜金曜に複数の#週番号があります。");
  const selected = [...deduped.values()];
  return {
    weekNumber: weekNumbers.size ? Number([...weekNumbers][0]) : null,
    // Release Master is already in sheet row order. Weekly features follow that
    // order; unlike Monthly/Japan, EP/date/artist sorting must not be applied.
    feature: selected.filter(album => album.weekAdoption === "採用"),
    others: sortWeeklyOthers(selected.filter(album => album.weekAdoption === "掲載")),
  };
}
/** A single Release Master row in the same editable shape used by initial import and re-import. */
export function createGeneratorItem(album: ReleaseMasterAlbum, series: GeneratorSeries, importedAt: string): GeneratorItem {
  const sourceFields = { title: album.title, artist: album.artist, duration: album.duration, genreMemo: album.genreMemo,
    country: album.country, trackNo: album.mjTrackNo, track: album.mjTrack, text: album.mjText };
  const contentFields = { ...sourceFields, title: series === "weekly" ? album.title : album.title.replace(ep, ""), text: series === "weekly" ? "" : album.mjText };
  return { id: randomUUID(), source: { kind: "release-master", uid: album.uid.trim() || null, no: album.no || null, date: album.date,
    importedAt, coverUrl: album.coverUrlLarge.trim() || album.coverUrl.trim() || null, fields: sourceFields }, content: { fields: contentFields, show: { title: true, artist: true, duration: true,
      genreMemo: true, country: series !== "japan", track: series !== "weekly" }, tracking: 0, kerns: {}, bodyLeadMode: "auto", bodyMaxLead: 42,
      typography: series === "weekly" ? { title: { tracking: 0, kerns: {}, leading: 72 / 54 } } : {}, jacketAssetId: null } };
}
export function importDocument(albums: ReleaseMasterAlbum[], series: MonthlyGeneratorSeries, month: string, importedAt = new Date().toISOString()): GeneratorDocument {
  const selected = selectReleaseMasterAlbums(albums, series, month), period = parseImportPeriod(month);
  const source = [...selected.adopted, ...selected.listed];
  if (!source.length) throw new GeneratorError("NOT_FOUND", 404, "対象月・企画の採用／掲載アルバムがありません。");
  if (source.length > 200) throw new GeneratorError("INVALID_INPUT", 400, "対象アルバムが多すぎます。");
  const items: GeneratorItem[] = source.map(album => createGeneratorItem(album, series, importedAt));
  const pages: GeneratorDocument["pages"] = [];
  let index = 0;
  for (let i = 0; i < selected.adopted.length; i++, index++) pages.push({ id: randomUUID(), kind: "adopted", itemIds: [items[index].id], bgColor: null });
  for (let i = 0; i < selected.listed.length; i += 2) {
    const count = Math.min(2, selected.listed.length - i);
    pages.push({ id: randomUUID(), kind: "listed", itemIds: items.slice(index, index + count).map(item => item.id), bgColor: null });
    index += count;
  }
  return parseDocument({ schemaVersion: 1, id: randomUUID(), series, period: { type: "month", ...period }, rendererVersion: "monthly-japan-v1",
    pages, theme: { useWave: true, waveAssetId: null, backgroundAssetId: null, outputSize: 2400 }, items });
}
export function importWeeklyDocument(albums: ReleaseMasterAlbum[], week: string, importedAt = new Date().toISOString()): GeneratorDocument {
  const selected = selectWeeklyAlbums(albums, week), period = parseWeeklyImportPeriod(week), source = [...selected.feature, ...selected.others];
  if (!source.length) throw new GeneratorError("NOT_FOUND", 404, "対象週のWEEK=採用／掲載アルバムがありません。");
  if (source.length > 200 || selected.feature.length > 5 || selected.others.length > 60) {
    throw new GeneratorError("INVALID_INPUT", 400, "WEEK列の採用は5件以下、掲載は60件以下にしてください。");
  }
  const items = source.map(album => createGeneratorItem(album, "weekly", importedAt));
  const pages: GeneratorDocument["pages"] = [{ id: randomUUID(), kind: "cover", itemIds: [], bgColor: null }];
  for (let index = 0; index < selected.feature.length; index++) pages.push({ id: randomUUID(), kind: "feature", itemIds: [items[index].id], bgColor: null });
  pages.push({ id: randomUUID(), kind: "others", itemIds: items.slice(selected.feature.length).map(item => item.id), bgColor: null });
  return parseDocument({ schemaVersion: 1, id: randomUUID(), series: "weekly", period: { type: "week", ...period, weekNumber: selected.weekNumber }, rendererVersion: "weekly-v1",
    pages, theme: { useWave: true, waveAssetId: null, backgroundAssetId: null, outputSize: 2400 }, items });
}
