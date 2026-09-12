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
