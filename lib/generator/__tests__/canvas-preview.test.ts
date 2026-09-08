import { describe, expect, it } from "vitest";
import { canvasPreviewPage } from "../canvas-preview";
import { importDocument, importWeeklyDocument } from "../source";
import type { ReleaseMasterAlbum } from "../../types";

const album = (overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum => ({
  no: "1", uid: crypto.randomUUID(), date: "2027-01-01", title: "Album", artist: "Artist", genre: "洋楽",
  duration: "10songs, 40min", weekNumber: "53", genreMemo: "Pop", country: "UK", weekAdoption: "採用", mjAdoption: "採用",
  mjAssign: "", mjTrackNo: "", mjTrack: "", mjStartTime: "", mjText: "", legacyScores: [], spotifyUrl: "", coverUrl: "", coverUrlLarge: "",
  ...overrides,
});

describe("generator canvas preview pages", () => {
  it("keeps Monthly numbering from image 2", () => {
    const document = importDocument([album({ date: "2026-08-01" })], "monthly", "2026-08");
    expect(canvasPreviewPage(document, 0)).toMatchObject({ kind: "adopted", no: 2, week: null });
  });

  it("numbers Weekly from cover 0 and derives cover jackets from feature order", () => {
    const document = importWeeklyDocument([
      album({ no: "1", title: "First", weekAdoption: "採用" }),
      album({ no: "2", title: "Second", weekAdoption: "採用" }),
      album({ no: "3", title: "Other", weekAdoption: "掲載" }),
    ], "2027-01-01");
    const cover = canvasPreviewPage(document, 0)!;
    expect(cover).toMatchObject({ kind: "cover", no: 0, week: { year: 2026, number: 53 } });
    expect(cover.slots.map(slot => slot.fields.title)).toEqual(["First", "Second"]);
    expect(canvasPreviewPage(document, 1)).toMatchObject({ kind: "feature", no: 1 });
    expect(canvasPreviewPage(document, 3)).toMatchObject({ kind: "others", no: 3 });
  });
});
