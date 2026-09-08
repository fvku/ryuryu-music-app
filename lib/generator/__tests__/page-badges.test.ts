import { describe, expect, it } from "vitest";
import { derivePageBadges, movePageItem, swapWeeklyFeatureItem } from "@/app/generator/[id]/workspace-types";

const pages = [
  { id: "p1", itemIds: ["i1"], bgColor: "#123456" },
  { id: "p2", itemIds: ["i2", "i3"], bgColor: null },
];

function derive(overrides: Partial<Parameters<typeof derivePageBadges>[0]> = {}) {
  return derivePageBadges({
    pages,
    isItemDirty: () => false,
    dirtyPageIds: new Set<string>(),
    pageColors: {},
    foreignLocks: [],
    ...overrides,
  });
}

describe("画像ごとのサムネイル表示状態", () => {
  it("未保存の作品がある画像だけを未保存にする", () => {
    const badges = derive({ isItemDirty: id => id === "i3" });
    expect(badges.p1.dirty).toBe(false);
    expect(badges.p2.dirty).toBe(true);
  });

  it("背景色だけが未保存でも、その画像を未保存にする", () => {
    const badges = derive({ dirtyPageIds: new Set(["p1"]) });
    expect(badges.p1.dirty).toBe(true);
    expect(badges.p2.dirty).toBe(false);
  });

  it("その画像に載る作品のロックを、画像の編集者として示す", () => {
    const badges = derive({ foreignLocks: [{ kind: "item", targetId: "i2", owner: "meri@example.com" }] });
    expect(badges.p1.lockedBy).toBeNull();
    expect(badges.p2.lockedBy).toBe("meri@example.com");
  });

  it("背景のロックも同じ画像に示す", () => {
    const badges = derive({ foreignLocks: [{ kind: "page", targetId: "p1", owner: "eddie@example.com" }] });
    expect(badges.p1.lockedBy).toBe("eddie@example.com");
  });

  it("共通設定・並び順のロックは特定の画像に結びつけない", () => {
    const badges = derive({
      foreignLocks: [
        { kind: "theme", targetId: "doc", owner: "kaede@example.com" },
        { kind: "structure", targetId: "doc", owner: "kaede@example.com" },
      ],
    });
    expect(badges.p1.lockedBy).toBeNull();
    expect(badges.p2.lockedBy).toBeNull();
  });

  it("背景色が未設定の画像を示し、編集中の色があれば設定済みとして扱う", () => {
    expect(derive().p1.needsColor).toBe(false);
    expect(derive().p2.needsColor).toBe(true);
    expect(derive({ pageColors: { p2: "#abcdef" } }).p2.needsColor).toBe(false);
  });
});

describe("Weeklyの並び順と選定", () => {
  const weekly = [
    { id: "cover", kind: "cover" as const, itemIds: [], bgColor: null },
    { id: "feature-1", kind: "feature" as const, itemIds: ["a"], bgColor: null },
    { id: "feature-2", kind: "feature" as const, itemIds: ["b"], bgColor: null },
    { id: "others", kind: "others" as const, itemIds: ["c", "d"], bgColor: null },
  ];

  it("メインの順番を入れ替えてもページごとの件数は変わらない", () => {
    const moved = movePageItem(weekly, "feature", "b", -1);
    expect(moved.map(page => page.itemIds)).toEqual([[], ["b"], ["a"], ["c", "d"]]);
    expect(moved.map(page => page.itemIds.length)).toEqual(weekly.map(page => page.itemIds.length));
  });

  it("メインとOthersは移動ではなくswapする", () => {
    const swapped = swapWeeklyFeatureItem(weekly, "a", "d");
    expect(swapped.map(page => page.itemIds)).toEqual([[], ["d"], ["b"], ["c", "a"]]);
    expect(swapped.map(page => page.itemIds.length)).toEqual(weekly.map(page => page.itemIds.length));
  });
});
