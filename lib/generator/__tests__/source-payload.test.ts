import { describe, expect, it } from "vitest";
import { pendingSourceUpdates, releaseMasterSource, sourceChanged } from "../../../app/generator/[id]/source-payload";
import type { GeneratorItemSource } from "../model";
import type { ReleaseMasterAlbum } from "../../types";

const album = {
  uid: " U1 ", no: "12", date: "2026/09/01", title: "Blue", artist: "Quartet", duration: "9songs, 30min",
  genreMemo: "Jazz", country: "US", mjTrackNo: "3", mjTrack: "Take", mjText: "本文",
  coverUrl: "https://small.example/a.jpg", coverUrlLarge: "https://large.example/a.jpg",
} as unknown as ReleaseMasterAlbum;

const base: GeneratorItemSource = releaseMasterSource(album, "2026-09-01T00:00:00.000Z");

describe("releaseMasterSource", () => {
  it("prefers the large cover and trims the uid", () => {
    expect(base.coverUrl).toBe("https://large.example/a.jpg");
    expect(base.uid).toBe("U1");
  });

  it("falls back to the small cover when the large one is empty", () => {
    const source = releaseMasterSource({ ...album, coverUrlLarge: "  " } as ReleaseMasterAlbum, "2026-09-01T00:00:00.000Z");
    expect(source.coverUrl).toBe("https://small.example/a.jpg");
  });

  it("keeps the Release Master title untouched, including an EP prefix", () => {
    const source = releaseMasterSource({ ...album, title: "[EP] Blue" } as ReleaseMasterAlbum, "2026-09-01T00:00:00.000Z");
    expect(source.fields.title).toBe("[EP] Blue");
  });
});

describe("sourceChanged", () => {
  it("ignores the import timestamp", () => {
    expect(sourceChanged(base, releaseMasterSource(album, "2026-09-12T00:00:00.000Z"))).toBe(false);
  });

  it("notices a replaced cover", () => {
    expect(sourceChanged(base, { ...base, coverUrl: "https://large.example/b.jpg" })).toBe(true);
  });
});

describe("pendingSourceUpdates", () => {
  const item = { id: "a", source: base };

  it("advances the baseline for an item whose fields the user accepted", () => {
    const next = { ...base, fields: { ...base.fields, genreMemo: "Fusion" } };
    expect(pendingSourceUpdates({ items: [item], sources: { a: next }, selectedItemIds: new Set(["a"]) })).toEqual({ a: next });
  });

  it("leaves an untouched item alone when only its text drifted", () => {
    const next = { ...base, fields: { ...base.fields, genreMemo: "Fusion" } };
    expect(pendingSourceUpdates({ items: [item], sources: { a: next }, selectedItemIds: new Set() })).toEqual({});
  });

  it("follows a replaced cover even when the user selected nothing", () => {
    const next = { ...base, coverUrl: "https://large.example/b.jpg" };
    expect(pendingSourceUpdates({ items: [item], sources: { a: next }, selectedItemIds: new Set() })).toEqual({ a: next });
  });

  it("never touches a manually added item", () => {
    const manual = { id: "m", source: { ...base, kind: "manual" as const } };
    expect(pendingSourceUpdates({ items: [manual], sources: { m: { ...base, coverUrl: null } }, selectedItemIds: new Set(["m"]) })).toEqual({});
  });

  it("returns nothing when the baseline is already current", () => {
    expect(pendingSourceUpdates({ items: [item], sources: { a: { ...base } }, selectedItemIds: new Set(["a"]) })).toEqual({});
  });
});
