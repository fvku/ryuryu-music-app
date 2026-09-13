import { describe, expect, it } from "vitest";
import { detectGeneratorImageMime, inspectGeneratorImage } from "../image";

function png(width: number, height: number) {
  const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10], 0); bytes.set([73,72,68,82], 12);
  view.setUint32(16, width); view.setUint32(20, height); return bytes;
}

describe("generator image validation", () => {
  it("reads PNG dimensions from its signature and IHDR", () => expect(inspectGeneratorImage(png(1200, 800), "image/png")).toEqual({ mimeType: "image/png", width: 1200, height: 800 }));
  it("detects MIME from bytes without trusting a response header", () => expect(detectGeneratorImageMime(png(1200, 800))).toBe("image/png"));
  it("rejects a claimed type mismatch", () => expect(() => inspectGeneratorImage(png(10, 10), "image/jpeg")).toThrow("PNG・JPEG・WebP"));
  it("rejects decompression-sized images", () => expect(() => inspectGeneratorImage(png(10000, 10000), "image/png")).toThrow("PNG・JPEG・WebP"));
  it("reads a JPEG start-of-frame", () => {
    const bytes = new Uint8Array(24); bytes.set([0xff,0xd8,0xff,0xe0,0,2,0xff,0xc0,0,11,8,0x03,0x20,0x04,0xb0,3,1,0x11,0]);
    expect(inspectGeneratorImage(bytes, "image/jpeg")).toEqual({ mimeType: "image/jpeg", width: 1200, height: 800 });
  });
  it("reads WebP extended dimensions", () => {
    const bytes = new Uint8Array(30); bytes.set([..."RIFF"].map(value => value.charCodeAt(0)), 0); bytes.set([..."WEBPVP8X"].map(value => value.charCodeAt(0)), 8); bytes[24] = 0xaf; bytes[25] = 4; bytes[27] = 0x1f; bytes[28] = 3;
    expect(inspectGeneratorImage(bytes, "image/webp")).toEqual({ mimeType: "image/webp", width: 1200, height: 800 });
  });
});
