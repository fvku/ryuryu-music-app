import { describe, expect, it } from "vitest";
import { pageEditBlocker, recoveryHasChanges } from "@/app/generator/[id]/workspace-types";

const page = { id: "p1", itemIds: ["i1", "i2"] };
const actor = "me@example.com";

function blocker(locks: { kind: string; targetId: string; owner: string }[], held: string[] = []) {
  return pageEditBlocker({
    page,
    documentId: "doc",
    locks,
    isHeld: (kind, targetId) => held.includes(`${kind}:${targetId}`),
    actor,
  });
}

describe("画像の編集を止めているロック", () => {
  it("誰もロックしていなければ止めない", () => {
    expect(blocker([])).toBeNull();
  });

  it("この画面が持っているロックでは止めない", () => {
    expect(blocker([{ kind: "page", targetId: "p1", owner: actor }], ["page:p1"])).toBeNull();
  });

  it("ほかの画像・ほかの作品のロックでは止めない", () => {
    expect(blocker([
      { kind: "page", targetId: "p2", owner: "other@example.com" },
      { kind: "item", targetId: "i9", owner: "other@example.com" },
      { kind: "theme", targetId: "doc", owner: "other@example.com" },
    ])).toBeNull();
  });

  it("他の人の背景・作品ロックで止め、その人を示す", () => {
    expect(blocker([{ kind: "item", targetId: "i2", owner: "other@example.com" }]))
      .toEqual({ kind: "item", targetId: "i2", owner: "other@example.com", self: false });
  });

  it("並び順のロックでも止める（DBが画像と並び順を同時にロックさせないため）", () => {
    expect(blocker([{ kind: "structure", targetId: "doc", owner: "other@example.com" }]))
      .toEqual({ kind: "structure", targetId: "doc", owner: "other@example.com", self: false });
  });

  it("同じ人の別画面のロックは、引き継げるものとして示す", () => {
    expect(blocker([{ kind: "page", targetId: "p1", owner: actor }]))
      .toEqual({ kind: "page", targetId: "p1", owner: actor, self: true });
  });

  it("自分の別画面と他の人の両方があれば、他の人を先に示す（引き継いでも編集できないため）", () => {
    expect(blocker([
      { kind: "page", targetId: "p1", owner: actor },
      { kind: "structure", targetId: "doc", owner: "other@example.com" },
    ])?.owner).toBe("other@example.com");
  });
});

describe("このブラウザの一時保存を知らせるか", () => {
  const saved = {
    items: [{ id: "i1", content: { fields: { title: "A" } } }],
    pages: [{ id: "p1", itemIds: ["i1"], bgColor: null }],
    theme: { useWave: true },
  } as unknown as Parameters<typeof recoveryHasChanges>[1];

  it("保存済みと同じなら知らせない（保存しても一時保存は消えないため）", () => {
    expect(recoveryHasChanges(structuredClone(saved), saved)).toBe(false);
  });

  it("作品の内容が違えば知らせる", () => {
    const recovered = structuredClone(saved);
    (recovered.items[0].content.fields as { title: string }).title = "B";
    expect(recoveryHasChanges(recovered, saved)).toBe(true);
  });

  it("背景色・並び順・共通設定のどれかが違えば知らせる", () => {
    const color = structuredClone(saved);
    color.pages[0].bgColor = "#123456";
    expect(recoveryHasChanges(color, saved)).toBe(true);
    const order = structuredClone(saved);
    order.pages[0].itemIds = [];
    expect(recoveryHasChanges(order, saved)).toBe(true);
    const theme = structuredClone(saved);
    (theme.theme as { useWave: boolean }).useWave = false;
    expect(recoveryHasChanges(theme, saved)).toBe(true);
  });
});
