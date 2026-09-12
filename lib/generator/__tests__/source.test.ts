import { describe, expect, it } from "vitest";
import type { ReleaseMasterAlbum } from "../../types";
import { importDocument, importWeeklyDocument, isoWeek, parseImportPeriod, parseWeeklyImportPeriod, selectReleaseMasterAlbums, selectWeeklyAlbums } from "../source";

const album = (overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum => ({ no: "1", uid: crypto.randomUUID(), date: "2026/08/03", title: "Album", artist: "Artist",
  genre: "洋楽", duration: "10songs, 40min", weekNumber: "32", genreMemo: "Jazz", country: "US", weekAdoption: "採用", mjAdoption: "採用", mjAssign: "", mjTrackNo: "2", mjTrack: "Song", mjStartTime: "",
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

describe("Weekly Release Master import", () => {
  it("accepts only Friday dates, computes the exclusive end, and uses the ISO week-year", () => {
    expect(parseWeeklyImportPeriod("2027-01-01")).toEqual({ start: "2027-01-01", end: "2027-01-08" });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(() => parseWeeklyImportPeriod("2026-08-27")).toThrow();
    expect(() => parseWeeklyImportPeriod("2026-02-30")).toThrow();
  });
  it("selects Saturday through Friday using the # week number, excludes blank/rejected rows, and deduplicates", () => {
    const features = Array.from({ length: 5 }, (_, index) => album({ no: String(index + 1), title: `Feature ${index + 1}`, artist: `Artist ${index + 1}`,
      date: `2026/08/${String(1 + index).padStart(2, "0")}`, weekAdoption: "採用", mjAdoption: index % 2 ? "不採用" : "" }));
    const listed = album({ no: "6", title: "Other", artist: "国内", date: "2026年8月7日", genre: "邦楽", weekAdoption: "掲載" });
    const duplicate = album({ no: "7", title: " feature 1 ", artist: " artist 1 ", date: "2026-08-07", weekAdoption: "掲載" });
    const result = selectWeeklyAlbums([
      ...features,
      listed,
      duplicate,
      album({ title: "Rejected", date: "2026-08-06", weekAdoption: "不採用" }),
      album({ title: "Blank", date: "2026-08-06", weekAdoption: "" }),
      album({ title: "Previous Friday", date: "2026-07-31", weekNumber: "31", weekAdoption: "採用" }),
      album({ title: "Next Saturday", date: "2026-08-08", weekNumber: "32", weekAdoption: "掲載" }),
    ], "2026-08-07");
    expect(result.weekNumber).toBe(32); expect(result.feature).toHaveLength(5); expect(result.others).toHaveLength(1);
    expect(result.feature.every(value => value.weekAdoption === "採用")).toBe(true);
    expect(result.others.every(value => value.weekAdoption === "掲載")).toBe(true);
    expect([...result.feature, ...result.others].map(value => value.title.trim().toLowerCase())).not.toContain("previous friday");
    expect([...result.feature, ...result.others].map(value => value.title.trim().toLowerCase())).not.toContain("next saturday");
    expect([...result.feature, ...result.others].map(value => value.title.trim().toLowerCase())).not.toContain("rejected");
  });
  it("keeps Weekly features in Release Master row order instead of sorting by EP, date, or artist", () => {
    const input = [
      album({ no: "1", title: "[EP] First row", artist: "Zulu", date: "2026-08-07", weekAdoption: "採用" }),
      album({ no: "2", title: "Second row", artist: "Alpha", date: "2026-08-01", weekAdoption: "採用" }),
      album({ no: "33", title: "Third row", artist: "Beta", date: "2026-08-03", weekAdoption: "採用" }),
    ];
    expect(selectWeeklyAlbums(input, "2026-08-07").feature.map(value => value.title))
      .toEqual(["[EP] First row", "Second row", "Third row"]);
  });
  it("rejects missing, invalid, or conflicting # values on WEEK rows", () => {
    expect(() => selectWeeklyAlbums([album({ date: "2026-08-07", weekNumber: "", weekAdoption: "採用" })], "2026-08-07")).toThrow();
    expect(() => selectWeeklyAlbums([album({ date: "2026-08-07", weekNumber: "54", weekAdoption: "掲載" })], "2026-08-07")).toThrow();
    expect(() => selectWeeklyAlbums([
      album({ date: "2026-08-06", weekNumber: "32", weekAdoption: "採用" }),
      album({ no: "2", title: "Other", date: "2026-08-07", weekNumber: "31", weekAdoption: "掲載" }),
    ], "2026-08-07")).toThrow();
  });
  it("creates cover, feature and others pages while preserving EP prefixes and disabling Weekly-only unused fields", () => {
    const input = [
      ...Array.from({ length: 5 }, (_, index) => album({ no: String(index + 1), title: `Album ${index + 1}`, date: "2026-08-07", weekAdoption: "採用", mjAdoption: "不採用" })),
      album({ no: "6", title: "[EP] Extra", date: "2026-08-07", weekAdoption: "掲載", coverUrl: "https://example.com/spotify.jpg", coverUrlLarge: "https://example.com/apple.jpg" }),
    ];
    const doc = importWeeklyDocument(input, "2026-08-07", "2026-09-08T00:00:00.000Z");
    expect(doc.rendererVersion).toBe("weekly-v1"); expect(doc.period).toEqual({ type: "week", start: "2026-08-07", end: "2026-08-14", weekNumber: 32 });
    expect(doc.pages.map(page => [page.kind, page.itemIds.length])).toEqual([["cover", 0], ["feature", 1], ["feature", 1], ["feature", 1], ["feature", 1], ["feature", 1], ["others", 1]]);
    const extra = doc.items.find(item => item.source.fields.title === "[EP] Extra")!;
    expect(extra.content.fields.title).toBe("[EP] Extra"); expect(extra.content.fields.text).toBe(""); expect(extra.content.show.track).toBe(false);
    expect(extra.source.fields.text).toBe("Text"); expect(extra.source.coverUrl).toBe("https://example.com/apple.jpg");
    expect(extra.content.typography.title).toEqual({ tracking: 0, kerns: {}, leading: 72 / 54 });
    expect(doc.theme.useWave).toBe(true);
  });
  it("orders Other Releases as albums (Western then Japanese) followed by EPs, each by artist a-z", () => {
    const week = { date: "2026-08-07", weekAdoption: "掲載" } as const;
    const input = [
      album({ no: "1", title: "Solo", artist: "Zed", genre: "洋楽", ...week }),
      album({ no: "2", title: "[EP] Japanese EP", artist: "aoi", genre: "邦楽", ...week }),
      album({ no: "3", title: "Domestic", artist: "Bob", genre: "邦楽", ...week }),
      album({ no: "4", title: "Western", artist: "alpha", genre: "洋楽", ...week }),
      album({ no: "5", title: "[EP] Western EP", artist: "Cee", genre: "洋楽", ...week }),
      album({ no: "6", title: "Unknown", artist: "Dee", genre: "" as ReleaseMasterAlbum["genre"], ...week }),
      album({ no: "7", title: "Feature", artist: "Main", genre: "洋楽", date: "2026-08-07", weekAdoption: "採用" }),
    ];
    const doc = importWeeklyDocument(input, "2026-08-07");
    const items = new Map(doc.items.map(item => [item.id, item]));
    const others = doc.pages.at(-1)!.itemIds.map(id => items.get(id)!.content.fields.title);
    // アルバム（洋楽→邦楽→洋邦が空）→ EP（洋楽→邦楽）。各区分の中はアーティスト名のa-z順。
    expect(others).toEqual(["Western", "Solo", "Domestic", "Unknown", "[EP] Western EP", "[EP] Japanese EP"]);
  });
  it("uses exactly the WEEK groups and keeps an empty others page", () => {
    const doc = importWeeklyDocument([album({ date: "2026-08-07", weekAdoption: "採用" }), album({ no: "2", title: "Second", date: "2026-08-06", weekAdoption: "採用" })], "2026-08-07");
    expect(doc.pages.map(page => [page.kind, page.itemIds.length])).toEqual([["cover", 0], ["feature", 1], ["feature", 1], ["others", 0]]);
  });
  it("enforces the single Other Releases page capacity and rejects empty weeks", () => {
    const values = Array.from({ length: 60 }, (_, index) => album({ no: String(index + 1), title: `Album ${index}`, date: "2026-08-07", weekAdoption: "掲載" }));
    expect(importWeeklyDocument(values, "2026-08-07").pages.at(-1)?.itemIds).toHaveLength(60);
    expect(() => importWeeklyDocument([...values, album({ no: "61", title: "Overflow", date: "2026-08-07", weekAdoption: "掲載" })], "2026-08-07")).toThrow();
    expect(() => importWeeklyDocument(Array.from({ length: 6 }, (_, index) => album({ no: String(index + 1), title: `Feature ${index}`, date: "2026-08-07", weekAdoption: "採用" })), "2026-08-07")).toThrow();
    expect(() => importWeeklyDocument([], "2026-08-07")).toThrow();
  });
});
