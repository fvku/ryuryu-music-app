import { describe, expect, it } from "vitest";
import { findListenerColumn, parseMonthlyListeners } from "./fill-listeners";

describe("月間リスナー数の読み取り", () => {
  it("ラベル付きの要素から正確な数値を読む（見出しの 47.1M ではなく）", () => {
    const html = '<meta content="Artist · 47.1M monthly listeners"><div data-testid="monthly-listeners-label">47,117,089 monthly listeners</div>';
    expect(parseMonthlyListeners(html)).toBe(47117089);
  });

  it("読めなければ null", () => {
    expect(parseMonthlyListeners("<div>47.1M monthly listeners</div>")).toBeNull();
    expect(parseMonthlyListeners("")).toBeNull();
  });
});

describe("リスナー列の位置", () => {
  it("GASが書いていた列（Google Script 作動）を優先する", () => {
    expect(findListenerColumn(["No.", "リスナー", "リスナー \nGoogle Script 作動", "memo"])).toBe(2);
  });

  it("無ければ「リスナー」列", () => {
    expect(findListenerColumn(["No.", "リスナー", "memo"])).toBe(1);
    expect(findListenerColumn(["No.", "memo"])).toBeUndefined();
  });
});
