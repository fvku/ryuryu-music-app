import { describe, expect, it } from "vitest";
import { applySelectedSpacing, rebaseKerns, selectedSpacing } from "../text-edit";

describe("generator text editing", () => {
  it("keeps character spacing aligned around inserted and deleted text", () => {
    expect(rebaseKerns("ABCDE", "ABxxCDE", { 0: 0.01, 2: 0.02, 4: -0.03 })).toEqual({ 0: 0.01, 4: 0.02, 6: -0.03 });
    expect(rebaseKerns("ABCDE", "ADE", { 0: 0.01, 1: 0.02, 3: -0.03 })).toEqual({ 0: 0.01, 1: -0.03 });
  });

  it("reports one selected value or Mixed without treating newlines as characters", () => {
    expect(selectedSpacing("AB\nCD", 0.01, { 0: 0.02, 1: 0.02 }, 0, 3)).toBe(0.03);
    expect(selectedSpacing("AB", 0.01, { 0: 0.02 }, 0, 2)).toBeNull();
    expect(selectedSpacing("AB", 0.01, {}, 1, 1)).toBe(0.01);
  });

  it("applies spacing only to a selection and preserves values outside it", () => {
    expect(applySelectedSpacing("ABCD", 0.01, { 0: -0.01, 3: 0.04 }, 1, 3, 0.03)).toEqual({
      tracking: 0.01,
      kerns: { 0: -0.01, 1: 0.02, 2: 0.02, 3: 0.04 },
    });
    expect(applySelectedSpacing("A\nB", 0, {}, 0, 3, 0.04)).toEqual({ tracking: 0, kerns: { 0: 0.04, 2: 0.04 } });
  });

  it("uses full-field tracking and clears per-character overrides when no text is selected", () => {
    expect(applySelectedSpacing("AB", 0.01, { 0: 0.04 }, 1, 1, -0.02)).toEqual({ tracking: -0.02, kerns: {} });
  });
});
