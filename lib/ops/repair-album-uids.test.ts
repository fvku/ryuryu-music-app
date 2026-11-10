import { describe, expect, it } from "vitest";
import { planUidRepairs } from "./repair-album-uids";

const rm = [
  { uid: "hejufxdf", title: "Blue Island", artist: "Ravyn Lenae" },
  { uid: "wujchxds", title: "Refractions", artist: "Cornelius" },
  { uid: "6emingz8", title: "祝おう", artist: "MASS OF THE FERMENTING DREGS" },
  { uid: "t820dyac", title: "生きものたちへ", artist: "矢野顕子" },
  { uid: "dup00001", title: "Same", artist: "A" },
  { uid: "dup00002", title: "Same", artist: "B" },
];
const spec = { titleIdx: 0, artistIdx: 1, uidIdx: 2 };

describe("planUidRepairs", () => {
  it("入れ替わったUIDを作品名で付け直す", () => {
    const { fixes } = planUidRepairs("scores", [
      ["Blue Island", "Ravyn Lenae", "wujchxds"],
      ["Refractions", "Cornelius", "hejufxdf"],
    ], spec, rm);
    expect(fixes.map((f) => [f.row, f.to])).toEqual([[2, "hejufxdf"], [3, "wujchxds"]]);
  });

  it("作品名が同じならアーティスト表記や [EP] が違っても正しいとみなす", () => {
    const { fixes, unresolved } = planUidRepairs("scores", [
      ["[EP] 祝おう", "MASS OF THE FERMENTING DREGS", "6emingz8"],
      ["生きものたちへ", "Akiko Yano", "t820dyac"],
    ], spec, rm);
    expect(fixes).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("アーティスト表記が違っても、作品名で1行に決まれば付け直す", () => {
    const { fixes } = planUidRepairs("scores", [["生きものたちへ", "Akiko Yano", "wujchxds"]], spec, rm);
    expect(fixes[0].to).toBe("t820dyac");
  });

  it("同名が複数・シートに無い作品は触らずに報告する", () => {
    const { fixes, unresolved } = planUidRepairs("scores", [
      ["Same", "C", "hejufxdf"],
      ["Deleted Album", "X", "zzzzzzzz"],
    ], spec, rm);
    expect(fixes).toEqual([]);
    expect(unresolved.map((u) => u.reason)).toEqual(["ambiguous", "no_match"]);
  });
});
