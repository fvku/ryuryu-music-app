import { describe, expect, it } from "vitest";
import { applySourceRefresh, collectSourceRefresh } from "@/app/generator/[id]/source-refresh";
import { importDocument, importWeeklyDocument } from "../source";
import type { ItemContent } from "../model";
import type { ReleaseMasterAlbum } from "../../types";

const album = (overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum => ({
  no: "1", uid: crypto.randomUUID(), date: "2026/08/03", title: "Album", artist: "Artist",
  genre: "洋楽", duration: "10songs, 40min", weekNumber: "32", genreMemo: "Jazz", country: "US",
  weekAdoption: "採用", mjAdoption: "採用", mjAssign: "", mjTrackNo: "2", mjTrack: "Song", mjStartTime: "",
  mjText: "Text", legacyScores: [], spotifyUrl: "", coverUrl: "", coverUrlLarge: "", ...overrides,
});
const monthly = (albums: ReleaseMasterAlbum[]) => importDocument(albums, "monthly", "2026-08", "2026-09-11T00:00:00.000Z");
const collect = (document: Parameters<typeof collectSourceRefresh>[0]["document"], albums: ReleaseMasterAlbum[], drafts: Record<string, ItemContent> = {}) =>
  collectSourceRefresh({ document, drafts, albums });

describe("Release Masterの再取得", () => {
  it("取り込んだ直後は差分を出さない（EP前置き・Weeklyの評価文の変換を含む）", () => {
    const albums = [album({ title: "[EP] Adopted" }), album({ no: "2", title: "Listed", mjAdoption: "掲載" })];
    expect(collect(monthly(albums), albums)).toEqual([]);
    const weeklyAlbums = [album({ date: "2026-08-07", title: "[EP] Feature" }), album({ no: "2", title: "Other", date: "2026-08-07", weekAdoption: "掲載" })];
    expect(collect(importWeeklyDocument(weeklyAlbums, "2026-08-07"), weeklyAlbums)).toEqual([]);
  });

  it("Release Master側で直した項目を、画像番号つきで差分に出す", () => {
    const albums = [album()];
    const document = monthly(albums);
    const results = collect(document, [{ ...albums[0], genreMemo: "Jazz / Soul", country: "UK" }]);
    expect(results).toHaveLength(1);
    expect(results[0].pageNo).toBe(2);
    expect(results[0].kind).toBe("adopted");
    expect(results[0].matched).toBe(true);
    expect(results[0].changes).toEqual([
      { key: "genreMemo", current: "Jazz", next: "Jazz / Soul", edited: false },
      { key: "country", current: "US", next: "UK", edited: false },
    ]);
  });

  it("手で直した項目は現在の下書きと比べ、手で修正済みとして返す", () => {
    const albums = [album()];
    const document = monthly(albums);
    const item = document.items[0];
    const drafts = { [item.id]: { ...item.content, fields: { ...item.content.fields, genreMemo: "自分で直したジャンル" } } };
    const results = collect(document, [{ ...albums[0], genreMemo: "Jazz / Soul" }], drafts);
    expect(results[0].changes).toEqual([{ key: "genreMemo", current: "自分で直したジャンル", next: "Jazz / Soul", edited: true }]);
  });

  it("その画像に出ない項目は比べない", () => {
    // 掲載画像に評価文は描画されないので、Release Masterの本文が変わっても差分にしない。
    const albums = [album({ mjAdoption: "掲載" }), album({ no: "2", title: "Second", mjAdoption: "掲載" })];
    expect(collect(monthly(albums), albums.map(value => ({ ...value, mjText: "書き直した本文" })))).toEqual([]);
    // Weekly の Other Releases は作品名とアーティストだけ。
    const weeklyAlbums = [album({ date: "2026-08-07" }), album({ no: "2", title: "Other", date: "2026-08-07", weekAdoption: "掲載" })];
    const weekly = importWeeklyDocument(weeklyAlbums, "2026-08-07");
    const changed = weeklyAlbums.map(value => ({ ...value, genreMemo: "Ambient", artist: "Renamed" }));
    const results = collect(weekly, changed);
    expect(results.find(item => item.kind === "others")!.changes.map(change => change.key)).toEqual(["artist"]);
    expect(results.find(item => item.kind === "feature")!.changes.map(change => change.key)).toEqual(["artist", "genreMemo"]);
  });

  it("表示を外した項目は比べない", () => {
    const albums = [album({ mjAdoption: "J採用" })];
    const document = importDocument(albums, "japan", "2026-08", "2026-09-11T00:00:00.000Z");
    // Japanは国を出さないので、Release Master側で変わっても差分にしない。
    expect(collect(document, [{ ...albums[0], country: "JP" }])).toEqual([]);
  });

  it("照合できない作品は、差分ではなく見つからない作品として返す", () => {
    const albums = [album()];
    const document = monthly(albums);
    const results = collect(document, [album({ no: "99", title: "別の作品", artist: "別のアーティスト" })]);
    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(false);
    expect(results[0].changes).toEqual([]);
  });

  it("手で足した作品は再取得の対象にしない", () => {
    const document = monthly([album()]);
    const manual = { ...document, items: document.items.map(item => ({ ...item, source: { ...item.source, kind: "manual" as const } })) };
    expect(collect(manual, [album({ no: "99", title: "別の作品", artist: "別のアーティスト" })])).toEqual([]);
  });

  it("No.が変わってもUIDで照合し、UIDが無ければ作品名とアーティストで照合する", () => {
    const source = album();
    const document = monthly([source]);
    const byUid = collect(document, [{ ...source, no: "999", genreMemo: "Soul" }]);
    expect(byUid[0].changes.map(change => change.key)).toEqual(["genreMemo"]);
    const legacy = monthly([{ ...source, uid: "" }]);
    const byName = collect(legacy, [{ ...source, uid: "", no: "999", genreMemo: "Soul" }]);
    expect(byName[0].changes.map(change => change.key)).toEqual(["genreMemo"]);
  });

  it("反映すると文字別の字間が新しい文字位置へ移る", () => {
    const document = monthly([album()]);
    const content: ItemContent = {
      ...document.items[0].content,
      kerns: { 0: -.01 },
      typography: { title: { tracking: -.02, kerns: { 4: .03 }, leading: 72 / 54 } },
    };
    const next = applySourceRefresh(content, [{ key: "title", next: "New Album" }, { key: "text", next: "Text 2" }]);
    expect(next.fields.title).toBe("New Album");
    expect(next.fields.text).toBe("Text 2");
    // "Album" の4文字目（m）は "New Album" では8文字目。
    expect(next.typography.title).toEqual({ tracking: -.02, kerns: { 8: .03 }, leading: 72 / 54 });
    expect(next.kerns).toEqual({ 0: -.01 });
    expect(content.fields.title).toBe("Album");
  });
});
