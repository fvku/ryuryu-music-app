import { describe, expect, it } from "vitest";
import { isImmersiveRoute } from "@/lib/app-chrome";
import {
  addedDateInTokyo,
  cleanTrackTitle,
  coverCrop,
  defaultFrameTime,
  fitText,
  groupByAddedDate,
  initialSelection,
  jacketUrlCandidates,
  parsePlaylistItems,
  storyArchiveName,
  storyFileName,
  type SavedTrack,
} from "../saved-tracks";

const track = (id: string, addedAt: string): SavedTrack => ({ id, title: id, artist: "A", thumbUrl: "t", coverUrl: "c", addedAt });
const measure = (value: string, size: number) => Array.from(value).length * size * 0.5;

describe("parsePlaylistItems", () => {
  const item = {
    added_at: "2026-11-02T12:08:11Z",
    track: { id: "1", name: "Song", type: "track", artists: [{ name: "A" }, { name: "B" }], album: { images: [{ url: "big" }, { url: "small" }] } },
  };

  it("大きい画像と小さい画像、連名のアーティストを取り出す", () => {
    expect(parsePlaylistItems([item])).toEqual([{ id: "1", title: "Song", artist: "A, B", coverUrl: "big", thumbUrl: "small", addedAt: "2026-11-02T12:08:11Z" }]);
  });

  it("削除済み・ローカル・ポッドキャスト・画像なしの行を除く", () => {
    expect(parsePlaylistItems([
      { added_at: "x", track: null },
      { ...item, track: { ...item.track, is_local: true } },
      { ...item, track: { ...item.track, type: "episode" } },
      { ...item, track: { ...item.track, album: { images: [] } } },
    ])).toEqual([]);
  });
});

describe("cleanTrackTitle", () => {
  it.each([
    ["expectations (feat. Chappell Roan)", "expectations"],
    ["Together [ft. Nikki Nair]", "Together"],
    ["Song - feat. Someone", "Song"],
    ["Dance (With Somebody)", "Dance (With Somebody)"],
    ["Valery (please don’t be mad at me)", "Valery (please don’t be mad at me)"],
  ])("%s", (input, expected) => expect(cleanTrackTitle(input)).toBe(expected));
});

describe("追加日のまとめ", () => {
  it("日本時間で日付を数える", () => {
    expect(addedDateInTokyo("2026-11-01T15:30:00Z")).toBe("2026-11-02");
  });

  it("新しい日付から順に、同じ日の中は元の並びのまま", () => {
    const groups = groupByAddedDate([track("old", "2026-10-26T12:00:00Z"), track("b", "2026-11-02T12:00:00Z"), track("a", "2026-11-02T12:00:00Z")]);
    expect(groups.map(group => [group.date, group.tracks.map(item => item.id)])).toEqual([["2026-11-02", ["b", "a"]], ["2026-10-26", ["old"]]]);
  });

  it("最新の追加分の先頭3曲を初期選択にする", () => {
    const latest = ["1", "2", "3", "4"].map(id => track(id, "2026-11-02T12:00:00Z"));
    expect(initialSelection([...latest, track("old", "2026-10-26T12:00:00Z")])).toEqual(["1", "2", "3"]);
    expect(initialSelection([])).toEqual([]);
  });
});

describe("coverCrop", () => {
  it("横長の素材は横方向だけ pan で動く", () => {
    expect(coverCrop(3524, 2622, 1080, 1920, 0)).toMatchObject({ x: 0, y: 0, height: 2622 });
    const right = coverCrop(3524, 2622, 1080, 1920, 1);
    expect(right.x + right.width).toBeCloseTo(3524);
  });

  it("縦長の素材は縦方向に動き、範囲外の pan は端で止まる", () => {
    const crop = coverCrop(1080, 3840, 1080, 1920, 2);
    expect(crop).toMatchObject({ x: 0, y: 1920, width: 1080, height: 1920 });
  });
});

describe("fitText", () => {
  const spec = { size: 54, minSize: 30, maxWidth: 670 };

  it("収まる文字はそのまま", () => {
    expect(fitText("Short", spec, measure)).toEqual({ text: "Short", size: 54, truncated: false });
  });

  it("長い文字は縮めて収める", () => {
    const result = fitText("a".repeat(40), spec, measure);
    expect(result.truncated).toBe(false);
    expect(result.size).toBeLessThan(54);
    expect(measure(result.text, result.size)).toBeLessThanOrEqual(670);
  });

  it("下限でも収まらなければ末尾を省略する", () => {
    const result = fitText("a".repeat(120), spec, measure);
    expect(result).toMatchObject({ size: 30, truncated: true });
    expect(result.text.endsWith("…")).toBe(true);
    expect(measure(result.text, 30)).toBeLessThanOrEqual(670);
  });
});

describe("その他", () => {
  it("1000pxの候補を先に、取れないときの640pxを後に返す", () => {
    expect(jacketUrlCandidates("https://i.scdn.co/image/ab67616d0000b273abc")).toEqual(["https://i.scdn.co/image/ab67616d000082c1abc", "https://i.scdn.co/image/ab67616d0000b273abc"]);
  });

  it("ファイル名は追加日と番号で決まる", () => {
    expect(storyFileName("2026-11-02", 1)).toBe("saved_tracks_26_11_02_01.png");
    expect(storyArchiveName("2026-11-02")).toBe("saved_tracks_26_11_02.zip");
  });

  it("初期フレームは動画の範囲に収まり、番号ごとに変わる", () => {
    const times = [0, 1, 2, 3].map(index => defaultFrameTime(index, 60));
    expect(new Set(times).size).toBe(4);
    for (const time of times) expect(time).toBeGreaterThanOrEqual(0);
    for (const time of times) expect(time).toBeLessThan(60);
  });

  it("この画面はアプリ共通のナビを残す", () => {
    expect(isImmersiveRoute("/generator/saved-tracks")).toBe(false);
    expect(isImmersiveRoute("/generator/abc")).toBe(true);
  });
});
