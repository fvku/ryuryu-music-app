import { describe, expect, it } from "vitest";
import { parsePcm } from "@/lib/generator/pcm";

function wav24(samples: number[][], rate = 44100): ArrayBuffer {
  const channels = samples.length, frames = samples[0].length, dataSize = frames * channels * 3;
  const buffer = new ArrayBuffer(44 + dataSize), view = new DataView(buffer);
  const put = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  put(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); put(8, "WAVE"); put(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 3, true); view.setUint16(32, channels * 3, true); view.setUint16(34, 24, true);
  put(36, "data"); view.setUint32(40, dataSize, true);
  for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) {
    const raw = Math.round(samples[channel][frame] * 8388607) & 0xffffff, at = 44 + (frame * channels + channel) * 3;
    view.setUint8(at, raw & 0xff); view.setUint8(at + 1, (raw >> 8) & 0xff); view.setUint8(at + 2, (raw >> 16) & 0xff);
  }
  return buffer;
}

function aiff16(samples: number[], rate = 44100): ArrayBuffer {
  const dataSize = samples.length * 2, buffer = new ArrayBuffer(12 + 26 + 16 + dataSize), view = new DataView(buffer);
  const put = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  put(0, "FORM"); view.setUint32(4, buffer.byteLength - 8); put(8, "AIFF");
  put(12, "COMM"); view.setUint32(16, 18); view.setUint16(20, 1); view.setUint32(22, samples.length); view.setUint16(26, 16);
  // 44100 を80bit拡張精度で
  view.setUint16(28, 0x400e); view.setUint32(30, 0xac440000); view.setUint32(34, 0);
  put(38, "SSND"); view.setUint32(42, 8 + dataSize); view.setUint32(46, 0); view.setUint32(50, 0);
  samples.forEach((value, index) => view.setInt16(54 + index * 2, Math.round(value * 32767)));
  void rate;
  return buffer;
}

describe("parsePcm", () => {
  it("24bitステレオのWAVを読む", () => {
    const result = parsePcm(wav24([[0, 0.5, -0.5], [1, -1, 0.25]]));
    expect(result?.sampleRate).toBe(44100);
    expect(result?.channels).toHaveLength(2);
    expect(Array.from(result!.channels[0])).toEqual([0, expect.closeTo(0.5, 5), expect.closeTo(-0.5, 5)]);
    expect(result!.channels[1][1]).toBeCloseTo(-1, 5);
  });
  it("16bitのAIFF（ビッグエンディアン）を読む", () => {
    const result = parsePcm(aiff16([0, 0.25, -0.75]));
    expect(result?.sampleRate).toBe(44100);
    expect(Array.from(result!.channels[0])).toEqual([0, expect.closeTo(0.25, 4), expect.closeTo(-0.75, 4)]);
  });
  it("知らない形式は null（ブラウザのエラーをそのまま出す）", () => {
    expect(parsePcm(new TextEncoder().encode("ID3........mp3data").buffer as ArrayBuffer)).toBeNull();
    expect(parsePcm(new ArrayBuffer(4))).toBeNull();
  });
});
