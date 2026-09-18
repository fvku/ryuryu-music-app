import { describe, expect, it } from "vitest";
import { movePageItemTo, structureDrop } from "@/app/generator/[id]/workspace-types";
import type { GeneratorPage } from "@/lib/generator/model";

const monthly = [
  { id: "p1", kind: "adopted", itemIds: ["a", "b"], bgColor: null },
  { id: "p2", kind: "adopted", itemIds: ["c", "d"], bgColor: null },
  { id: "p3", kind: "listed", itemIds: ["x", "y"], bgColor: null },
] as unknown as GeneratorPage[];

const order = (pages: GeneratorPage[]) => pages.map(page => page.itemIds.join("")).join("|");

describe("同じ区分の中へ差し込む", () => {
  it("後ろへ差し込み、ページごとの件数は変えない", () => {
    expect(order(movePageItemTo(monthly, "adopted", "a", 2))).toBe("bc|ad|xy");
  });

  it("前へ差し込む", () => {
    expect(order(movePageItemTo(monthly, "adopted", "d", 0))).toBe("da|bc|xy");
  });

  it("ほかの区分には触れない", () => {
    expect(movePageItemTo(monthly, "adopted", "a", 3)[2]).toBe(monthly[2]);
  });

  it("範囲外・同じ位置・存在しない作品は何もしない", () => {
    expect(movePageItemTo(monthly, "adopted", "a", 9)).toBe(monthly);
    expect(movePageItemTo(monthly, "adopted", "a", 0)).toBe(monthly);
    expect(movePageItemTo(monthly, "adopted", "zz", 1)).toBe(monthly);
  });
});

describe("ドラッグで落としたときに何が起きるか", () => {
  const rows = [
    { id: "a", kind: "adopted" as const }, { id: "b", kind: "adopted" as const },
    { id: "c", kind: "adopted" as const }, { id: "x", kind: "listed" as const },
  ];

  it("下の行の下半分へ落とすと、その後ろへ入る", () => {
    expect(structureDrop({ rows, draggedId: "a", overId: "c", after: true, weekly: false }))
      .toEqual({ type: "move", kind: "adopted", itemId: "a", toIndex: 2 });
  });

  it("上の行の上半分へ落とすと、その前へ入る", () => {
    expect(structureDrop({ rows, draggedId: "c", overId: "a", after: false, weekly: false }))
      .toEqual({ type: "move", kind: "adopted", itemId: "c", toIndex: 0 });
  });

  it("元と同じ位置になる落とし方は何もしない", () => {
    expect(structureDrop({ rows, draggedId: "b", overId: "a", after: true, weekly: false })).toBeNull();
    expect(structureDrop({ rows, draggedId: "b", overId: "c", after: false, weekly: false })).toBeNull();
    expect(structureDrop({ rows, draggedId: "b", overId: "b", after: true, weekly: false })).toBeNull();
  });

  it("採用と掲載の間は動かさない", () => {
    expect(structureDrop({ rows, draggedId: "a", overId: "x", after: true, weekly: false })).toBeNull();
  });

  it("Weeklyのメインと Others の間は、どちらから落としても入れ替える", () => {
    const weeklyRows = [{ id: "f1", kind: "feature" as const }, { id: "o1", kind: "others" as const }];
    expect(structureDrop({ rows: weeklyRows, draggedId: "o1", overId: "f1", after: false, weekly: true }))
      .toEqual({ type: "swap", featureId: "f1", otherId: "o1" });
    expect(structureDrop({ rows: weeklyRows, draggedId: "f1", overId: "o1", after: true, weekly: true }))
      .toEqual({ type: "swap", featureId: "f1", otherId: "o1" });
  });
});
