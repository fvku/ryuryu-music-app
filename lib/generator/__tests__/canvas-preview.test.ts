import { describe, expect, it } from "vitest";
import { canvasPreviewPage, COVER_SLOT_LABELS, pageNumber } from "../canvas-preview";
import { importDocument, importWeeklyDocument } from "../source";
import type { ReleaseMasterAlbum } from "../../types";

const album = (overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum => ({
  no: "1", uid: crypto.randomUUID(), date: "2027-01-01", title: "Album", artist: "Artist", genre: "洋楽",
  duration: "10songs, 40min", weekNumber: "53", genreMemo: "Pop", playlistMemo: "", country: "UK", weekAdoption: "採用", mjAdoption: "採用",
  mjAssign: "", mjTrackNo: "", mjTrack: "", mjStartTime: "", mjText: "", legacyScores: [], spotifyUrl: "", coverUrl: "", coverUrlLarge: "",
  ...overrides,
});

describe("generator canvas preview pages", () => {
  it("numbers the Monthly cover 01 and keeps the first adopted image at 02", () => {
    const document = importDocument([album({ date: "2026-08-01" })], "monthly", "2026-08");
    expect(canvasPreviewPage(document, 0)).toMatchObject({ kind: "cover", no: 1, week: null, coverLayout: "grid" });
    expect(canvasPreviewPage(document, 1)).toMatchObject({ kind: "adopted", no: 2, week: null, coverLayout: null });
  });

  it("keeps image 02 first for older Monthly documents without a cover", () => {
    const document = importDocument([album({ date: "2026-08-01" })], "monthly", "2026-08");
    const legacy = { ...document, pages: document.pages.slice(1) };
    expect(pageNumber(legacy, 0)).toBe(2);
    expect(canvasPreviewPage(legacy, 0)).toMatchObject({ kind: "adopted", no: 2 });
  });

  it("fills the Japan collage with the first six works in adopted → listed order and follows reordering", () => {
    const input = [
      ...["A1", "A2", "A3", "A4", "A5"].map((title, index) => album({ no: String(index + 1), title, date: `2026-09-0${index + 1}`, mjAdoption: "J採用" })),
      ...["L1", "L2", "L3"].map((title, index) => album({ no: String(index + 6), title, date: `2026-09-0${index + 1}`, mjAdoption: "J掲載" })),
    ];
    const document = importDocument(input, "japan", "2026-09");
    document.items[5].content.coverFocusY = .8;
    const cover = canvasPreviewPage(document, 0)!;
    expect(cover.slots.map(slot => slot.fields.title)).toEqual(["A1", "A2", "A3", "A4", "A5", "L1"]);
    expect(cover.slots[5].coverFocusY).toBe(.8);
    expect(cover.slots.every(slot => slot.coverFocusX === undefined)).toBe(true);
    // 掲載の上下を入れ替えると、表紙の6枚目も入れ替わる（表紙にitemIdを保存しないため）。
    const listed = document.pages.find(page => page.kind === "listed")!;
    listed.itemIds.reverse();
    expect(canvasPreviewPage(document, 0)!.slots[5].fields.title).toBe("L2");
    expect(cover.coverLayout).toBe("collage");
    expect(COVER_SLOT_LABELS.collage).toHaveLength(6);
  });

  it("fills the Monthly 3×3 cover with the first nine works in posting order", () => {
    const input = [
      ...Array.from({ length: 7 }, (_, index) => album({ no: String(index + 1), title: `A${index + 1}`, date: `2026-09-0${index + 1}`, mjAdoption: "採用" })),
      ...Array.from({ length: 4 }, (_, index) => album({ no: String(index + 8), title: `L${index + 1}`, date: `2026-09-0${index + 1}`, mjAdoption: "掲載" })),
    ];
    const document = importDocument(input, "monthly", "2026-09");
    const cover = canvasPreviewPage(document, 0)!;
    expect(cover.coverLayout).toBe("grid");
    expect(cover.slots.map(slot => slot.fields.title)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "L1", "L2"]);
    expect(COVER_SLOT_LABELS.grid).toHaveLength(9);
    // 9件に満たない月は、足りない枠を空けたまま（作品を繰り返さない）。
    const few = importDocument(input.slice(0, 4), "monthly", "2026-09");
    expect(canvasPreviewPage(few, 0)!.slots).toHaveLength(4);
  });

  it("numbers Weekly from cover 0 and derives cover jackets from feature order", () => {
    const document = importWeeklyDocument([
      album({ no: "1", title: "First", weekAdoption: "採用" }),
      album({ no: "2", title: "Second", weekAdoption: "採用" }),
      album({ no: "3", title: "Other", weekAdoption: "掲載" }),
    ], "2027-01-01");
    document.items[0].content.coverFocusX = .23;
    const cover = canvasPreviewPage(document, 0)!;
    expect(cover).toMatchObject({ kind: "cover", no: 0, week: { year: 2026, number: 53 } });
    expect(cover.slots.map(slot => slot.fields.title)).toEqual(["First", "Second"]);
    expect(cover.slots[0].coverFocusX).toBe(.23);
    [document.pages[1].itemIds, document.pages[2].itemIds] = [document.pages[2].itemIds, document.pages[1].itemIds];
    expect(canvasPreviewPage(document, 0)!.slots[1].coverFocusX).toBe(.23);
    expect(canvasPreviewPage(document, 1)).toMatchObject({ kind: "feature", no: 1 });
    expect(canvasPreviewPage(document, 3)).toMatchObject({ kind: "others", no: 3 });
  });
});
