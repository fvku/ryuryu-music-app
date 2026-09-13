import { GeneratorError } from "./errors";

export type GeneratorImage = { mimeType: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number };

function invalid(): never { throw new GeneratorError("INVALID_IMAGE", 400, "PNG・JPEG・WebPの有効な画像を選んでください。"); }
function u16(bytes: Uint8Array, offset: number): number { return (bytes[offset] << 8) | bytes[offset + 1]; }
function u32(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset); }
function dimensions(width: number, height: number): Pick<GeneratorImage, "width" | "height"> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 40_000_000) invalid();
  return { width, height };
}

/** 外部レスポンスのContent-Typeを信用せず、許可した画像形式を署名から決める。 */
export function detectGeneratorImageMime(bytes: Uint8Array): GeneratorImage["mimeType"] {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  invalid();
}

export function inspectGeneratorImage(bytes: Uint8Array, claimedType: string): GeneratorImage {
  if (bytes.length < 24 || bytes.length > 10 * 1024 * 1024) invalid();
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    if (claimedType !== "image/png" || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") invalid();
    return { mimeType: "image/png", ...dimensions(u32(bytes, 16), u32(bytes, 20)) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (claimedType !== "image/jpeg") invalid();
    const startsOfFrame = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = u16(bytes, offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if (startsOfFrame.has(marker)) return { mimeType: "image/jpeg", ...dimensions(u16(bytes, offset + 5), u16(bytes, offset + 3)) };
      offset += length;
    }
    invalid();
  }
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    if (claimedType !== "image/webp") invalid();
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === "VP8X" && bytes.length >= 30) return { mimeType: "image/webp", ...dimensions(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)) };
    if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(21, true);
      return { mimeType: "image/webp", ...dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)) };
    }
    if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { mimeType: "image/webp", ...dimensions(u16(bytes, 26) & 0x3fff, u16(bytes, 28) & 0x3fff) };
  }
  invalid();
}
