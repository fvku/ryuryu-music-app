import { describe, expect, it } from "vitest";
import { imageSaveTargets } from "../../../app/generator/[id]/workspace-types";

const titleOf = (id: string) => ({ a: "First", b: "Second", c: "" }[id] ?? "");

describe("imageSaveTargets", () => {
  it("returns nothing when neither the items nor the colour changed", () => {
    expect(imageSaveTargets({
      page: { id: "p", itemIds: ["a", "b"] },
      savedBgColor: "#111111",
      pageColors: { p: "#111111" },
      titleOf,
      isItemDirty: () => false,
    })).toEqual([]);
  });

  it("saves every changed item on the image, then the background colour", () => {
    expect(imageSaveTargets({
      page: { id: "p", itemIds: ["a", "b"] },
      savedBgColor: "#111111",
      pageColors: { p: "#222222" },
      titleOf,
      isItemDirty: id => id === "a" || id === "b",
    })).toEqual([
      { kind: "item", targetId: "a", label: "作品「First」" },
      { kind: "item", targetId: "b", label: "作品「Second」" },
      { kind: "page", targetId: "p", label: "背景色" },
    ]);
  });

  it("keeps the item order of the image and skips untouched items", () => {
    expect(imageSaveTargets({
      page: { id: "p", itemIds: ["a", "b", "c"] },
      savedBgColor: "#111111",
      pageColors: {},
      titleOf,
      isItemDirty: id => id !== "b",
    })).toEqual([
      { kind: "item", targetId: "a", label: "作品「First」" },
      { kind: "item", targetId: "c", label: "作品「作品名未入力」" },
    ]);
  });

  it("saves a colour that is set for the first time on an image without one", () => {
    expect(imageSaveTargets({
      page: { id: "p", itemIds: [] },
      savedBgColor: null,
      pageColors: { p: "#334455" },
      titleOf,
      isItemDirty: () => false,
    })).toEqual([{ kind: "page", targetId: "p", label: "背景色" }]);
  });

  it("ignores colours belonging to other images", () => {
    expect(imageSaveTargets({
      page: { id: "p", itemIds: [] },
      savedBgColor: "#111111",
      pageColors: { other: "#999999" },
      titleOf,
      isItemDirty: () => false,
    })).toEqual([]);
  });
});

describe("imageSaveTargets（曲の選択）", () => {
  it("saves the page when only the song choice changed, and names both when the colour changed too", () => {
    const base = { page: { id: "p", itemIds: ["a", "b"] }, savedBgColor: "#111111", titleOf, isItemDirty: () => false };
    expect(imageSaveTargets({ ...base, pageColors: {}, musicChanged: true })).toEqual([{ kind: "page", targetId: "p", label: "曲の選択" }]);
    expect(imageSaveTargets({ ...base, pageColors: { p: "#222222" }, musicChanged: true })).toEqual([{ kind: "page", targetId: "p", label: "背景色・曲の選択" }]);
  });
});

describe("same（キーの順を問わない比較）", () => {
  it("treats objects with reordered keys as unchanged, but not different values", async () => {
    const { same } = await import("../../../app/generator/[id]/workspace-types");
    expect(same({ music: { start: null, audioId: "a" }, x: 1 }, { x: 1, music: { audioId: "a", start: null } })).toBe(true);
    expect(same({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(true);
  });
});
