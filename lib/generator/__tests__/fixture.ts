import { randomUUID } from "node:crypto";
import type { GeneratorDocument, GeneratorItem, Fields } from "../model";

export function fixture(): GeneratorDocument {
  const text: Fields = { title: "Album", artist: "Artist", duration: "10songs, 40min", genreMemo: "Jazz", country: "JP", trackNo: "1", track: "Song", text: "レビュー\n本文🎵" };
  const items: GeneratorItem[] = Array.from({ length: 3 }, (_, index) => ({
    id: randomUUID(), source: { kind: "manual", uid: null, no: null, date: "", importedAt: null, coverUrl: null, fields: { ...text } },
    content: { fields: { ...text, title: `Album ${index}` }, show: { title: true, artist: true, duration: true, genreMemo: true, country: false, track: true },
      tracking: -.02, kerns: { 1: .02 }, bodyLeadMode: "auto", bodyMaxLead: 42,
      typography: { title: { tracking: -.03, kerns: { 0: .01 }, leading: 1.4 } }, jacketAssetId: null },
  }));
  return { schemaVersion: 1, id: randomUUID(), series: "monthly", period: { type: "month", start: "2026-08-01", end: "2026-09-01" },
    rendererVersion: "monthly-japan-v1", items,
    pages: [{ id: randomUUID(), kind: "adopted", itemIds: [items[0].id], bgColor: "#123456" },
      { id: randomUUID(), kind: "listed", itemIds: [items[1].id, items[2].id], bgColor: "#abcdef" }],
    theme: { useWave: true, waveAssetId: null, backgroundAssetId: null, outputSize: 2400 } };
}
