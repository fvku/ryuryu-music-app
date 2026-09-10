import { describe, expect, it } from "vitest";
import type { ReleaseMasterAlbum } from "../../types";
import { buildReimport, collectReimportDiff } from "../reimport";
import { importWeeklyDocument } from "../source";

const album = (overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum => ({
  no: "1", uid: "uid-a", date: "2027/01/01", title: "A", artist: "Artist A", genre: "洋楽",
  duration: "10songs, 40min", weekNumber: "53", genreMemo: "Rock", country: "US", weekAdoption: "採用",
  mjAdoption: "", mjAssign: "", mjTrackNo: "", mjTrack: "", mjStartTime: "", mjText: "source text",
  legacyScores: [], spotifyUrl: "", coverUrl: "", coverUrlLarge: "", ...overrides,
});

describe("generator re-import", () => {
  it("detects add/remove/move using UID, and does not mistake Weekly import transforms for edits", () => {
    const document = importWeeklyDocument([album(), album({ no: "2", uid: "uid-b", title: "B", artist: "Artist B", weekAdoption: "掲載" })], "2027-01-01", "2026-09-11T00:00:00.000Z");
    const currentA = document.items.find(item => item.source.uid === "uid-a")!;
    const currentB = document.items.find(item => item.source.uid === "uid-b")!;
    const latest = [album({ weekAdoption: "掲載" }), album({ no: "3", uid: "uid-c", title: "C", artist: "Artist C", weekAdoption: "採用" })];
    const diff = collectReimportDiff(document, latest);
    expect(diff.added).toEqual([expect.objectContaining({ key: "uid:uid-c", group: "feature" })]);
    expect(diff.removed).toEqual([expect.objectContaining({ itemId: currentB.id, edited: false })]);
    expect(diff.moved).toEqual([expect.objectContaining({ itemId: currentA.id, from: "feature", to: "others" })]);
  });

  it("keeps surviving item IDs/content and page colours while applying the selected set", () => {
    const document = importWeeklyDocument([album(), album({ no: "2", uid: "uid-b", title: "B", artist: "Artist B", weekAdoption: "掲載" })], "2027-01-01", "2026-09-11T00:00:00.000Z");
    const currentA = document.items.find(item => item.source.uid === "uid-a")!;
    const currentB = document.items.find(item => item.source.uid === "uid-b")!;
    currentA.content.fields.title = "Hand edited A";
    document.pages.find(page => page.kind === "feature")!.bgColor = "#111111";
    document.pages.find(page => page.kind === "others")!.bgColor = "#222222";
    const latest = [album({ weekAdoption: "掲載" }), album({ no: "3", uid: "uid-c", title: "C", artist: "Artist C", weekAdoption: "採用" })];
    const result = buildReimport({ document, albums: latest, addKeys: ["uid:uid-c"], removeItemIds: [currentB.id], resort: false, importedAt: "2026-09-11T01:00:00.000Z" });
    const feature = result.pages.find(page => page.kind === "feature")!, others = result.pages.find(page => page.kind === "others")!;
    expect(feature.bgColor).toBeNull(); expect(others.bgColor).toBe("#222222");
    expect(result.addItems).toHaveLength(1); expect(feature.itemIds).toEqual([result.addItems[0].id]);
    expect(others.itemIds).toEqual([currentA.id]);
    expect(document.items.find(item => item.id === currentA.id)?.content.fields.title).toBe("Hand edited A");
  });

  it("falls back from a changed UID to No. before title and artist", () => {
    const document = importWeeklyDocument([album()], "2027-01-01");
    const diff = collectReimportDiff(document, [album({ uid: "new-uid", title: "Renamed", artist: "Renamed artist" })]);
    expect(diff.added).toHaveLength(0); expect(diff.removed).toHaveLength(0); expect(diff.moved).toHaveLength(0);
  });
});
