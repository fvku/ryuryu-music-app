import { describe, expect, it } from "vitest";
import { nearestBandField } from "@/app/generator/hit-test";

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
