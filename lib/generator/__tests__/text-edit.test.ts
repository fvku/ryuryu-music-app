import { describe, expect, it } from "vitest";
import { applySelectedSpacing, keepEarlierLines, rebaseKerns, selectedSpacing, type LaidOutLine } from "../text-edit";

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

  describe("keepEarlierLines", () => {
    // 1文字1かたまり、幅は「1 + 字間」、枠幅は5で先頭から詰める簡易な折り返し。
    const text = "ABCDEFGHIJ";
    const layout = ({ tracking, kerns }: { tracking: number; kerns: Record<string, number> }): LaidOutLine[] => {
      const lines: LaidOutLine[] = [];
      let line: LaidOutLine = { start: 0, end: 0, clusters: [] }, width = 0;
      for (let at = 0; at < text.length; at += 1) {
        const advance = 1 + tracking + (kerns[at] || 0);
        if (line.clusters.length && width + advance >= 5 - 0.01) {
          lines.push(line);
          line = { start: at, end: at, clusters: [] };
          width = 0;
        }
        line.clusters.push({ at, text: text[at] });
        line.end = at + 1;
        width += advance;
      }
      lines.push(line);
      return lines;
    };
    const before = { tracking: 0, kerns: {} };

    it("leaves the change as is when earlier lines keep their breaks", () => {
      // 1行目=ABCD、2行目=EFGH。2行目の途中（F〜G）を詰めても1行目は変わらない。
      const after = applySelectedSpacing(text, 0, {}, 5, 7, -0.5);
      expect(keepEarlierLines(before, after, 5, 7, layout)).toEqual({ ...after, held: null });
    });

    it("holds the first character of the line so it does not move up to the previous line", () => {
      // 2行目の先頭Eを -0.5 にすると 1行目に収まってしまう（4 + 0.5 < 4.99）。
      const after = applySelectedSpacing(text, 0, {}, 4, 8, -0.5);
      const result = keepEarlierLines(before, after, 4, 8, layout);
      expect(layout(result).slice(0, 1)).toEqual(layout(before).slice(0, 1));
      expect(result.held).toMatchObject({ start: 4, end: 5 });
      expect(result.held!.value).toBeGreaterThan(-0.5);
      expect(result.held!.value).toBeLessThanOrEqual(0);
      // ほかの文字は指定どおり。
      expect(selectedSpacing(text, result.tracking, result.kerns, 5, 8)).toBe(-0.5);
    });

    it("holds every selected character of a word that starts the line", () => {
      // 「EFG」を1かたまり（欧文の単語）として折り返す。単語を詰めると1行目に上がる。
      const wordLayout = (spacing: { tracking: number; kerns: Record<string, number> }): LaidOutLine[] => layout(spacing).map(line => {
        const clusters = line.clusters.filter(cluster => cluster.at < 5 || cluster.at > 6)
          .map(cluster => cluster.at === 4 ? { at: 4, text: "EFG" } : cluster);
        return { ...line, clusters };
      });
      const after = applySelectedSpacing(text, 0, {}, 4, 7, -0.5);
      const result = keepEarlierLines(before, after, 4, 7, wordLayout);
      expect(result.held).toMatchObject({ start: 4, end: 7 });
      expect(selectedSpacing(text, result.tracking, result.kerns, 4, 7)).toBe(result.held!.value);
      expect(wordLayout(result)[0]).toEqual(wordLayout(before)[0]);
    });

    it("does nothing for the whole field or the first line", () => {
      const after = applySelectedSpacing(text, 0, {}, 0, 3, -0.5);
      expect(keepEarlierLines(before, after, 0, 3, layout).held).toBeNull();
    });
  });
});
