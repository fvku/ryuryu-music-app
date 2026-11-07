import { describe, expect, it } from "vitest";
import { cutAudio, delayProbeSignal, dragRange, effectiveRange, fadeGain, measureDelay, rgbaToI420, formatClock, matchStartTimes, parseClock, parseVideoPreference, videoFileName, waveformLevels } from "@/lib/generator/video";

describe("parseClock / formatClock", () => {
  it("Release Master の Start Time の書き方を読む", () => {
    expect(parseClock("1:03")).toBe(63);
    expect(parseClock("0:00")).toBe(0);
    expect(parseClock(" 01:09 ")).toBe(69);
    expect(parseClock("63")).toBe(63);
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });
  it("秒を m:ss で出す", () => {
    expect(formatClock(63)).toBe("1:03");
    expect(formatClock(59.9)).toBe("0:59");
    expect(formatClock(-3)).toBe("0:00");
  });
  it("0.1秒単位でも出せる（端数が無ければ省く）", () => {
    expect(formatClock(63.45, true)).toBe("1:03.5");
    expect(formatClock(63, true)).toBe("1:03");
    expect(formatClock(59.96, true)).toBe("1:00");
  });
});

describe("effectiveRange", () => {
  it("曲の長さが分からない間は指定どおり（長さは1〜59秒に収める）", () => {
    expect(effectiveRange({ start: 63, length: 59 }, null)).toEqual({ start: 63, length: 59, trimmed: false });
    expect(effectiveRange({ start: 0, length: 90 }, null).length).toBe(59);
  });
  it("曲の終わりを越える分は削り、そのことを返す", () => {
    expect(effectiveRange({ start: 200, length: 59 }, 238)).toEqual({ start: 200, length: 38, trimmed: true });
  });
  it("開始が曲の外なら、曲の終わりの1秒前へ寄せる", () => {
    expect(effectiveRange({ start: 500, length: 59 }, 238)).toEqual({ start: 237, length: 1, trimmed: true });
  });
});

describe("matchStartTimes", () => {
  const albums = [
    { uid: "8ls8in7c", no: "2771", title: "ONDO", artist: "Lucky Kilimanjaro", mjTrackNo: "6", mjTrack: "フラワー", mjStartTime: "1:09" },
    { uid: "", no: "2753", title: "Wonder Tree", artist: "高井息吹", mjTrackNo: "2", mjTrack: "Tick it", mjStartTime: "0:38" },
    { uid: "", no: "", title: "Ｂｌｕｅ", artist: "Band", mjTrackNo: "", mjTrack: "", mjStartTime: "" },
  ];
  it("UID → No. → 作品名＋アーティストの順で照合する", () => {
    const result = matchStartTimes([
      { id: "a", uid: "8ls8in7c", no: "9999", title: "x", artist: "y" },
      { id: "b", uid: null, no: "2753", title: "x", artist: "y" },
      { id: "c", uid: null, no: null, title: "blue", artist: "band" },
      { id: "d", uid: null, no: null, title: "none", artist: "none" },
    ], albums);
    expect(result.a).toEqual({ startTime: "1:09", trackNo: "6", track: "フラワー" });
    expect(result.b.startTime).toBe("0:38");
    expect(result.c.startTime).toBe("");
    expect(result.d).toBeUndefined();
  });
});

describe("parseVideoPreference", () => {
  it("壊れた値は使わない", () => {
    expect(parseVideoPreference(null)).toBeNull();
    expect(parseVideoPreference("{")).toBeNull();
    expect(parseVideoPreference(JSON.stringify({ start: "1" }))).toBeNull();
    expect(parseVideoPreference(JSON.stringify({ start: 3, length: 40, fadeIn: true }))).toEqual({ start: 3, length: 40, fadeIn: true, fadeOut: false });
  });
});

describe("videoFileName / waveformLevels", () => {
  it("PNGと同じ名前に作品名を足す", () => {
    expect(videoFileName("2026-11_monthly_03.png", "Wonder Tree")).toBe("2026-11_monthly_03_Wonder-Tree.mp4");
    expect(videoFileName("a.png", "A/B:C")).toBe("a_ABC.mp4");
  });
  it("音圧が高く最大振幅がそろっていても、大きい区間と小さい区間に差が出る", () => {
    // 4区間：どれも最大振幅は1だが、実効値は 小・小・大・中
    const shape = [0.1, 0.1, 0.9, 0.5];
    const samples = new Float32Array(4 * 100).map((_, index) => {
      const bucket = Math.floor(index / 100), position = index % 100;
      return position === 0 ? 1 : shape[bucket] * (position % 2 ? 1 : -1);
    });
    const levels = waveformLevels([samples], 4);
    expect(levels[2]).toBeCloseTo(1, 5);
    expect(levels[0]).toBeLessThan(0.1);
    expect(levels[3]).toBeGreaterThan(levels[0]);
    expect(levels[3]).toBeLessThan(levels[2]);
  });
  it("一定の音や無音は平らに出す", () => {
    expect(new Set(waveformLevels([new Float32Array(400).fill(0.5)], 4)).size).toBe(1);
    expect(waveformLevels([], 4)).toEqual([]);
  });
});

describe("dragRange", () => {
  const origin = { start: 60, length: 59 };
  it("move は長さを保って動かし、曲の中に収める", () => {
    expect(dragRange(origin, "move", 10.04, 238)).toEqual({ start: 70, length: 59 });
    expect(dragRange(origin, "move", -100, 238)).toEqual({ start: 0, length: 59 });
    expect(dragRange(origin, "move", 500, 238)).toEqual({ start: 179, length: 59 });
  });
  it("start は終わりを固定し、長さは1〜59秒", () => {
    expect(dragRange(origin, "start", 5, 238)).toEqual({ start: 65, length: 54 });
    expect(dragRange(origin, "start", 200, 238)).toEqual({ start: 118, length: 1 });
    expect(dragRange({ start: 60, length: 40 }, "start", -40, 238)).toEqual({ start: 41, length: 59 });
  });
  it("end は頭を固定し、曲の終わりと59秒を越えない", () => {
    expect(dragRange(origin, "end", -9.5, 238)).toEqual({ start: 60, length: 49.5 });
    expect(dragRange(origin, "end", 30, 238)).toEqual({ start: 60, length: 59 });
    expect(dragRange({ start: 200, length: 30 }, "end", 30, 238)).toEqual({ start: 200, length: 38 });
  });
});

describe("fadeGain", () => {
  it("フェードなしは常に1", () => {
    expect(fadeGain(0, 59, false, false)).toBe(1);
    expect(fadeGain(58.9, 59, false, false)).toBe(1);
  });
  it("頭の1秒で0→1、終わりの2秒で1→0（試聴の直線ランプと同じ）", () => {
    expect(fadeGain(0, 59, true, false)).toBe(0);
    expect(fadeGain(0.5, 59, true, false)).toBeCloseTo(0.5);
    expect(fadeGain(1, 59, true, false)).toBe(1);
    expect(fadeGain(57, 59, false, true)).toBe(1);
    expect(fadeGain(58, 59, false, true)).toBeCloseTo(0.5);
    expect(fadeGain(59, 59, false, true)).toBe(0);
  });
  it("短い区間でも両方掛けられ、1を超えない", () => {
    expect(fadeGain(0.25, 0.5, true, true)).toBeLessThanOrEqual(1);
    expect(fadeGain(0.5, 0.5, true, true)).toBe(0);
  });
});

describe("cutAudio", () => {
  const rate = 10;
  const ramp = Float32Array.from({ length: 100 }, (_, index) => index / 100);
  it("開始・長さの分だけ切り出し、ステレオにする（1chは複製）", () => {
    const [left, right] = cutAudio([ramp], rate, { start: 2, length: 3, fadeIn: false, fadeOut: false });
    expect(left.length).toBe(30);
    expect(left[0]).toBeCloseTo(0.2);
    expect(left[29]).toBeCloseTo(0.49);
    expect(Array.from(right)).toEqual(Array.from(left));
  });
  it("3ch以上は先頭の2chを使う", () => {
    const zero = new Float32Array(100), one = new Float32Array(100).fill(1);
    const out = cutAudio([one, zero, one], rate, { start: 0, length: 1, fadeIn: false, fadeOut: false });
    expect(out).toHaveLength(2);
    expect(out[0][5]).toBe(1);
    expect(out[1][5]).toBe(0);
  });
  it("曲の終わりを越えた分は作らない", () => {
    const [left] = cutAudio([ramp], rate, { start: 8, length: 5, fadeIn: false, fadeOut: false });
    expect(left.length).toBe(20);
  });
  it("フェードを掛ける", () => {
    const one = new Float32Array(100).fill(1);
    const [left] = cutAudio([one, one], rate, { start: 0, length: 5, fadeIn: true, fadeOut: true });
    expect(left[0]).toBe(0);
    expect(left[5]).toBeCloseTo(0.5);
    expect(left[20]).toBe(1);
    expect(left[40]).toBeCloseTo(0.5);
  });
});

describe("measureDelay", () => {
  it("遅らせた分のサンプル数を返す", () => {
    const reference = delayProbeSignal(16384, 4096, 8192);
    const delayed = new Float32Array(16384 + 3000);
    delayed.set(reference.map(value => value * 0.7), 2112);
    expect(measureDelay(reference, delayed, 4096, 4096, 4096)).toBe(2112);
  });
  it("遅れが無ければ0", () => {
    const reference = delayProbeSignal(16384, 4096, 8192);
    expect(measureDelay(reference, reference, 4096, 4096, 4096)).toBe(0);
  });
  it("一致しなければ null", () => {
    const reference = delayProbeSignal(16384, 4096, 8192);
    expect(measureDelay(reference, new Float32Array(20000), 4096, 4096, 4096)).toBeNull();
  });
});

describe("rgbaToI420", () => {
  const solid = (r: number, g: number, b: number) => Uint8ClampedArray.from({ length: 2 * 2 * 4 }, (_, index) => [r, g, b, 255][index % 4]);
  it("黒は16、白は235（テレビ用の範囲）、灰色の色差は128", () => {
    expect(Array.from(rgbaToI420(solid(0, 0, 0), 2, 2))).toEqual([16, 16, 16, 16, 128, 128]);
    expect(Array.from(rgbaToI420(solid(255, 255, 255), 2, 2))).toEqual([235, 235, 235, 235, 128, 128]);
  });
  it("フルレンジは黒0・白255", () => {
    expect(Array.from(rgbaToI420(solid(0, 0, 0), 2, 2, true))).toEqual([0, 0, 0, 0, 128, 128]);
    expect(Array.from(rgbaToI420(solid(255, 255, 255), 2, 2, true))).toEqual([255, 255, 255, 255, 128, 128]);
  });
  it("BT.709の係数で変換する（赤）", () => {
    const [y, , , , u, v] = Array.from(rgbaToI420(solid(255, 0, 0), 2, 2));
    expect(y).toBe(63);
    expect(u).toBe(102);
    expect(v).toBe(240);
  });
});
