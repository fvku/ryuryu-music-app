import { describe, expect, it } from "vitest";
import { formatTimeTracks } from "./time-format";

const ms = (min: number, sec: number) => (min * 60 + sec) * 1000;

describe("formatTimeTracks", () => {
  it("60分未満は分と秒で書く", () => {
    expect(formatTimeTracks(9, ms(29, 9))).toBe("9songs, 29min 9sec");
    expect(formatTimeTracks(12, ms(59, 59))).toBe("12songs, 59min 59sec");
  });

  it("60分以上は時間と分で書き、秒は切り捨てる", () => {
    expect(formatTimeTracks(24, ms(84, 59))).toBe("24songs, 1hr 24min");
    expect(formatTimeTracks(30, ms(125, 0))).toBe("30songs, 2hr 5min");
  });

  it("分が0でも省略しない", () => {
    expect(formatTimeTracks(15, ms(60, 0))).toBe("15songs, 1hr 0min");
    expect(formatTimeTracks(15, ms(60, 30))).toBe("15songs, 1hr 0min");
  });

  it("端数のミリ秒は秒に丸めてから判定する", () => {
    expect(formatTimeTracks(10, ms(59, 59) + 600)).toBe("10songs, 1hr 0min");
    expect(formatTimeTracks(10, ms(40, 12) + 400)).toBe("10songs, 40min 12sec");
  });
});
