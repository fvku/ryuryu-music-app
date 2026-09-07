import { randomUUID } from "node:crypto";
import type { ReleaseMasterAlbum } from "../types";
import { GeneratorError } from "./errors";
import { parseDocument, type GeneratorDocument, type GeneratorItem } from "./model";

export type GeneratorSeries = "monthly" | "japan";
const adoption = { monthly: { adopted: "採用", listed: "掲載" }, japan: { adopted: "J採用", listed: "J掲載" } } as const;
const ep = /^\s*[\[［]\s*ep\s*[\]］]\s*/i;

function yearMonth(value: string): string {
  const match = value.match(/(\d{4})\D+(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : "";
}
function dateKey(value: string): number {
  const match = value.match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
  return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3] || 0) : Number.MAX_SAFE_INTEGER;
}
function sortAlbums(albums: ReleaseMasterAlbum[]): ReleaseMasterAlbum[] {
  return albums.slice().sort((a, b) => Number(ep.test(a.title)) - Number(ep.test(b.title)) || dateKey(a.date) - dateKey(b.date)
    || (a.artist.toLowerCase() < b.artist.toLowerCase() ? -1 : a.artist.toLowerCase() > b.artist.toLowerCase() ? 1 : 0));
}
export function parseImportPeriod(value: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new GeneratorError("INVALID_INPUT", 400, "対象月はYYYY-MM形式で指定してください。");
  const [year, month] = value.split("-").map(Number);
  const start = `${value}-01`, endDate = new Date(Date.UTC(year, month, 1));
  return { start, end: endDate.toISOString().slice(0, 10) };
}
export function selectReleaseMasterAlbums(albums: ReleaseMasterAlbum[], series: GeneratorSeries, month: string) {
  const values = adoption[series];
  const deduped = new Map<string, ReleaseMasterAlbum>();
  for (const album of albums) {
    if (yearMonth(album.date) !== month || (album.mjAdoption !== values.adopted && album.mjAdoption !== values.listed)) continue;
    const key = `${album.title.trim().toLowerCase()}::${album.artist.trim().toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, album);
  }
  const selected = [...deduped.values()];
  return { adopted: sortAlbums(selected.filter(album => album.mjAdoption === values.adopted)),
    listed: sortAlbums(selected.filter(album => album.mjAdoption === values.listed)) };
}
export function importDocument(albums: ReleaseMasterAlbum[], series: GeneratorSeries, month: string, importedAt = new Date().toISOString()): GeneratorDocument {
  const selected = selectReleaseMasterAlbums(albums, series, month), period = parseImportPeriod(month);
  const source = [...selected.adopted, ...selected.listed];
  if (!source.length) throw new GeneratorError("NOT_FOUND", 404, "対象月・企画の採用／掲載アルバムがありません。");
  if (source.length > 200) throw new GeneratorError("INVALID_INPUT", 400, "対象アルバムが多すぎます。");
  const items: GeneratorItem[] = source.map(album => {
    const sourceFields = { title: album.title, artist: album.artist, duration: album.duration, genreMemo: album.genreMemo,
      country: album.country, trackNo: album.mjTrackNo, track: album.mjTrack, text: album.mjText };
    const contentFields = { ...sourceFields, title: album.title.replace(ep, "") };
    return { id: randomUUID(), source: { kind: "release-master", uid: album.uid.trim() || null, no: album.no || null, date: album.date,
      importedAt, coverUrl: album.coverUrlLarge.trim() || album.coverUrl.trim() || null, fields: sourceFields }, content: { fields: contentFields, show: { title: true, artist: true, duration: true,
        genreMemo: true, country: series !== "japan", track: true }, tracking: 0, kerns: {}, bodyLeadMode: "auto", bodyMaxLead: 42, typography: {}, jacketAssetId: null } };
  });
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
