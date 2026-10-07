import { describe, expect, it } from "vitest";
import { hitTest, nearestBandField } from "@/app/generator/hit-test";

describe("generator preview band hit testing", () => {
  it("selects the nearest editable segment, including the recommendation title", () => {
    const layout = {
      cell: { x: 0, y: 0, w: 400, h: 80 },
      total: 300,
      gap: 20,
      parts: [
        { key: null, width: 80 },
        { key: null, width: 10 },
        { key: "trackNo", width: 40 },
        { key: "track", width: 110 },
      ],
    };
    expect(nearestBandField(layout, 190, ["trackNo", "track"])).toBe("trackNo");
    expect(nearestBandField(layout, 300, ["trackNo", "track"])).toBe("track");
  });

  it("ignores fixed and separator segments", () => {
    const layout = { cell: { x: 0, y: 0, w: 200, h: 40 }, total: 80, gap: 10, parts: [{ key: null, width: 30 }] };
    expect(nearestBandField(layout, 100, ["trackNo", "track"])).toBeNull();
  });
});

// 実際の版面ではメイン順と左右の帯順が違うため、5本とも正しい作品を選ぶことを確認する。
it("selects each Weekly cover jacket in its rendered band", async () => {
  const { default: layout } = await import("@/tools/generator-lab/core/layout.mjs");
  const runtime = { layout } as unknown as Parameters<typeof hitTest>[0];
  const page = { kind: "cover", slots: Array.from({ length: 5 }, () => ({})) } as Parameters<typeof hitTest>[2];
  for (const [band, rank] of [3, 1, 0, 2, 4].entries()) {
    expect(hitTest(runtime, {} as CanvasRenderingContext2D, page, band * 240 + 120, 600)?.slotIndex).toBe(rank);
  }
  expect(hitTest(runtime, {} as CanvasRenderingContext2D, page, -1, 600)).toBeNull();
});

// Monthly／Japan表紙のコラージュ。斜めの枠のどこを押しても、その枠の作品（文書の先頭からの順）を選ぶ。
it("selects each Monthly/Japan collage jacket inside its slanted slot", async () => {
  const { default: layout } = await import("@/tools/generator-lab/core/layout.mjs");
  const runtime = { layout } as unknown as Parameters<typeof hitTest>[0];
  const page = { kind: "cover", coverLayout: "collage", slots: Array.from({ length: 6 }, () => ({})) } as unknown as Parameters<typeof hitTest>[2];
  const at = (x: number, y: number) => hitTest(runtime, {} as CanvasRenderingContext2D, page, x, y)?.slotIndex;
  expect([at(200, 200), at(900, 100), at(900, 450), at(1000, 900), at(300, 700), at(200, 1100)]).toEqual([0, 1, 2, 3, 4, 5]);
  // 縦の切れ目は上ほど右。同じx=520でも、上端は左上、切れ目の下では中央右になる。
  expect(at(520, 10)).toBe(0);
  expect(at(520, 400)).toBe(2);
  // 作品が5件しか無い文書では、6枠目は何も選ばない。
  const five = { ...page, slots: page.slots.slice(0, 5) } as Parameters<typeof hitTest>[2];
  expect(hitTest(runtime, {} as CanvasRenderingContext2D, five, 200, 1100)).toBeNull();
});
