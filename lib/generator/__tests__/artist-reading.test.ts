import { beforeAll, describe, expect, it } from "vitest";
import { compareArtistReading, guessArtistReading, prepareArtistReading } from "../artist-reading";
import { sortAlbums } from "../source";
import type { ReleaseMasterAlbum } from "../../types";

const album = (artist: string, overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum => ({
  no: "1", uid: crypto.randomUUID(), date: "2026/09/09", title: "Album", artist, genre: "邦楽",
  duration: "", weekNumber: "", genreMemo: "", playlistMemo: "", country: "", weekAdoption: "", mjAdoption: "J掲載",
  mjAssign: "", mjTrackNo: "", mjTrack: "", mjStartTime: "", mjText: "", legacyScores: [], spotifyUrl: "", coverUrl: "", coverUrlLarge: "",
  ...overrides,
});
const order = (albums: ReleaseMasterAlbum[]) => sortAlbums(albums).map(value => value.artist);

describe("同じ日付のアーティスト名の並び（a-z・あいうえお順）", () => {
  beforeAll(() => prepareArtistReading(), 30000);

  it("漢字の名前を読みで並べる（文字コード順の 細野→松田→斉藤→石川 にはしない）", () => {
    expect(guessArtistReading("斉藤和義")).toBe("さいとうかずよし");
    expect(order([album("細野晴臣"), album("松田今宵"), album("斉藤和義"), album("石川紅奈")]))
      .toEqual(["石川紅奈", "斉藤和義", "細野晴臣", "松田今宵"]);
  });

  it("英字はa-z（大文字小文字を区別しない）で、日本語より先", () => {
    expect(order([album("Yoyou"), album("ハク。"), album("HUGEN"), album("kiki vivi lily"), album("Tempalay")]))
      .toEqual(["HUGEN", "kiki vivi lily", "Tempalay", "Yoyou", "ハク。"]);
  });

  it("Release Masterの「読み」列があれば推定より優先する", () => {
    // 推定は「ゆうもと」「かそけたい」と読み違える。読み列で「ありもと」「ゆうたい」に直せる。
    const guessed = order([album("有元キイチ"), album("幽体コミュニケーションズ"), album("石川紅奈")]);
    expect(guessed).toEqual(["石川紅奈", "幽体コミュニケーションズ", "有元キイチ"]);
    const fixed = order([
      album("有元キイチ", { artistReading: "ありもと" }), album("幽体コミュニケーションズ", { artistReading: "ゆうたいコミュニケーションズ" }), album("石川紅奈"),
    ]);
    expect(fixed).toEqual(["有元キイチ", "石川紅奈", "幽体コミュニケーションズ"]);
  });

  it("日付・EPの規則が先で、アーティスト名は同じ日付どうしだけに効く", () => {
    const albums = [
      album("あいみょん", { date: "2026/09/16" }),
      album("ZAZEN BOYS", { date: "2026/09/02" }),
      album("坂本慎太郎", { date: "2026/09/02", title: "[EP] Short" }),
    ];
    expect(order(albums)).toEqual(["ZAZEN BOYS", "あいみょん", "坂本慎太郎"]);
    expect(compareArtistReading(album("a"), album("A"))).not.toBe(0); // 読みが同じでも名前で決着し、並びが揺れない
  });
});
