import { describe, expect, it } from "vitest";
import type { ReleaseMasterAlbum } from "../../types";
import { importDocument, parseImportPeriod, selectReleaseMasterAlbums } from "../source";

const album = (overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum => ({ no: "1", uid: crypto.randomUUID(), date: "2026/08/03", title: "Album", artist: "Artist",
  genre: "洋楽", duration: "10songs, 40min", genreMemo: "Jazz", country: "US", mjAdoption: "採用", mjAssign: "", mjTrackNo: "2", mjTrack: "Song", mjStartTime: "",
  mjText: "Text", legacyScores: [], spotifyUrl: "", coverUrl: "", coverUrlLarge: "", ...overrides });
describe("generator Release Master import", () => {
  it("computes exact month boundaries including leap years", () => {
    expect(parseImportPeriod("2024-02")).toEqual({ start: "2024-02-01", end: "2024-03-01" });
    expect(() => parseImportPeriod("2024-2")).toThrow();
  });
  it("selects the requested series and month, deduplicates, puts EP last", () => {
    const regular = album({ title: "B", date: "2026-08-20", mjAdoption: "掲載" });
    const result = selectReleaseMasterAlbums([album({ title: "[EP] A", date: "2026-08-01" }), regular, { ...regular, uid: crypto.randomUUID() }, album({ title: "J", mjAdoption: "J採用" }), album({ title: "Old", date: "2026-07-01" })], "monthly", "2026-08");
    expect(result.adopted.map(a => a.title)).toEqual(["[EP] A"]); expect(result.listed).toHaveLength(1);
  });
  it("creates adopted and odd listed pages while preserving source and editable values", () => {
    const input = [album({ title: "[EP] Adopted" }), album({ no: "2", title: "Listed A", mjAdoption: "掲載" }), album({ no: "3", title: "Listed B", mjAdoption: "掲載" }), album({ no: "4", title: "Listed C", mjAdoption: "掲載" })];
    const doc = importDocument(input, "monthly", "2026-08", "2026-09-05T00:00:00.000Z");
    expect(doc.pages.map(page => [page.kind, page.itemIds.length])).toEqual([["adopted", 1], ["listed", 2], ["listed", 1]]);
    expect(doc.items[0].source.fields.title).toBe("[EP] Adopted"); expect(doc.items[0].content.fields.title).toBe("Adopted");
    expect(doc.items[0].content.fields.duration).toBe("10songs, 40min");
    expect(doc.items[0].source.coverUrl).toBeNull();
    expect(doc.items[0].source.importedAt).toBe("2026-09-05T00:00:00.000Z");
    expect(doc.items[0].content.bodyLeadMode).toBe("auto");
    expect(doc.items[0].content.bodyMaxLead).toBe(42);
  });
  it("uses Japan choices and hides country by default", () => {
    const doc = importDocument([album({ mjAdoption: "J採用" })], "japan", "2026-08");
    expect(doc.series).toBe("japan"); expect(doc.items[0].content.show.country).toBe(false);
  });
  it("prefers the large Apple Music cover and falls back to the existing cover", () => {
    const large = importDocument([album({ coverUrl: "https://example.com/spotify.jpg", coverUrlLarge: "https://example.com/apple.jpg" })], "monthly", "2026-08");
    const fallback = importDocument([album({ coverUrl: "https://example.com/spotify.jpg" })], "monthly", "2026-08");
    expect(large.items[0].source.coverUrl).toBe("https://example.com/apple.jpg");
    expect(fallback.items[0].source.coverUrl).toBe("https://example.com/spotify.jpg");
  });
  it("rejects empty source months", () => expect(() => importDocument([], "monthly", "2026-08")).toThrow());
});
