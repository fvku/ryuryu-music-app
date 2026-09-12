import { describe, expect, it } from "vitest";
import { coverColorCandidates, fitForBackground, rgbToHsv } from "../cover-color";

function pixels(colors: [number, number, number, number?][]): Uint8ClampedArray {
  return Uint8ClampedArray.from(colors.flatMap(([r, g, b, a]) => [r, g, b, a ?? 255]));
}
const hexToRgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];

describe("fitForBackground", () => {
  it("keeps the hue and pulls the value into the usable band", () => {
    const bright = fitForBackground(255, 240, 200);
    const { h, v } = rgbToHsv(...hexToRgb(bright));
    expect(Math.round(h)).toBe(44);
    expect(v).toBeLessThanOrEqual(0.751);
    expect(v).toBeGreaterThanOrEqual(0.449);
  });

  it("lifts a near-black colour instead of returning it unchanged", () => {
    const { v } = rgbToHsv(...hexToRgb(fitForBackground(8, 4, 12)));
    expect(v).toBeGreaterThanOrEqual(0.449);
  });

  it("calms a fully saturated colour", () => {
    const { s } = rgbToHsv(...hexToRgb(fitForBackground(255, 0, 0)));
    expect(s).toBeLessThanOrEqual(0.601);
    expect(s).toBeGreaterThanOrEqual(0.249);
  });

  it("gives a grey a usable saturation floor rather than leaving it flat", () => {
    const { s } = rgbToHsv(...hexToRgb(fitForBackground(128, 128, 128)));
    expect(s).toBeGreaterThanOrEqual(0.249);
  });
});

describe("coverColorCandidates", () => {
  it("orders candidates by the area they cover", () => {
    const result = coverColorCandidates(pixels([
      [200, 40, 40], [200, 40, 40], [200, 40, 40],
      [40, 60, 200], [40, 60, 200],
      [40, 200, 80],
    ]));
    expect(result).toHaveLength(3);
    expect(rgbToHsv(...hexToRgb(result[0].hex)).h).toBeCloseTo(0, 0);
    expect(result[0].share).toBeGreaterThan(result[1].share);
  });

  it("ignores greys, blown highlights and crushed shadows", () => {
    const result = coverColorCandidates(pixels([
      [128, 128, 128], [250, 250, 250], [4, 4, 4], [190, 60, 60],
    ]));
    expect(result).toHaveLength(1);
    expect(rgbToHsv(...hexToRgb(result[0].hex)).h).toBeCloseTo(0, 0);
  });

  it("falls back to the average when the cover has no usable colour", () => {
    const result = coverColorCandidates(pixels([[128, 128, 128], [130, 130, 130]]));
    expect(result).toHaveLength(1);
    expect(result[0].share).toBe(1);
  });

  it("returns nothing for a fully transparent cover", () => {
    expect(coverColorCandidates(pixels([[200, 40, 40, 0], [40, 60, 200, 0]]))).toEqual([]);
  });

  it("never returns more candidates than asked for", () => {
    const many = Array.from({ length: 40 }, (_, index) => [(index * 37) % 256, (index * 91) % 256, (index * 53) % 256] as [number, number, number]);
    expect(coverColorCandidates(pixels(many), 4).length).toBeLessThanOrEqual(4);
  });
});
