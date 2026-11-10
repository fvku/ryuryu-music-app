import { describe, expect, it } from "vitest";
import { changedMjFields, findMjConflicts } from "./mj-concurrency";

describe("changedMjFields", () => {
  it("変えた項目だけを返し、空白だけの違いは無視する", () => {
    const base = { mjText: "原稿", country: "UK", genreMemo: "Rock" };
    expect(changedMjFields(base, { mjText: "原稿 ", country: "US", genreMemo: "Rock" })).toEqual({ country: "US" });
  });

  it("送らない項目（undefined）は変更に含めない", () => {
    expect(changedMjFields({ mjTrack: "Song" }, { mjText: "新しい原稿" })).toEqual({ mjText: "新しい原稿" });
  });

  it("空にする変更も変更として扱う", () => {
    expect(changedMjFields({ mjTrack: "Song", mjTrackNo: "3" }, { mjTrack: "", mjTrackNo: "" })).toEqual({ mjTrack: "", mjTrackNo: "" });
  });
});

describe("findMjConflicts", () => {
  it("開いた後に他の人が同じ項目を書き換えていたら衝突", () => {
    const conflicts = findMjConflicts({ mjText: "Bの原稿" }, { mjText: "元" }, { mjText: "Aの原稿" });
    expect(conflicts).toEqual([{ field: "mjText", current: "Aの原稿" }]);
  });

  it("他の人が別の項目を変えただけなら衝突しない", () => {
    expect(findMjConflicts({ country: "US" }, { country: "UK", mjText: "元" }, { country: "UK", mjText: "Aの原稿" })).toEqual([]);
  });

  it("他の人の値が自分の値と同じなら衝突しない", () => {
    expect(findMjConflicts({ country: "US" }, { country: "UK" }, { country: "US" })).toEqual([]);
  });

  it("base が無い項目は照合しない", () => {
    expect(findMjConflicts({ mjText: "x" }, {}, { mjText: "y" })).toEqual([]);
  });
});
