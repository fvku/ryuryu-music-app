/**
 * 非圧縮のWAV／AIFFを、ブラウザの音声デコーダーを使わずに読む。
 * ChromeはAIFFを `decodeAudioData` で読めない（Safariは読める）。手元の音源にAIFが多いため、
 * そのときの予備として使う。圧縮形式（mp3・m4a など）はブラウザに任せる。
 */
export type PcmAudio = { sampleRate: number; channels: Float32Array<ArrayBuffer>[] };

const text = (view: DataView, offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

function readSamples(view: DataView, offset: number, frames: number, channelCount: number, bits: number, float: boolean, little: boolean): Float32Array<ArrayBuffer>[] {
  const bytes = bits / 8, channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const at = offset + (frame * channelCount + channel) * bytes;
      let value: number;
      if (float) value = bits === 64 ? view.getFloat64(at, little) : view.getFloat32(at, little);
      else if (bits === 8) value = little ? (view.getUint8(at) - 128) / 128 : view.getInt8(at) / 128;
      else if (bits === 16) value = view.getInt16(at, little) / 32768;
      else if (bits === 24) {
        const b0 = view.getUint8(at), b1 = view.getUint8(at + 1), b2 = view.getUint8(at + 2);
        const raw = little ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
        value = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608;
      } else value = view.getInt32(at, little) / 2147483648;
      channels[channel][frame] = value;
    }
  }
  return channels;
}

function parseWav(view: DataView): PcmAudio | null {
  let offset = 12, format = 0, channelCount = 0, sampleRate = 0, bits = 0;
  while (offset + 8 <= view.byteLength) {
    const id = text(view, offset), size = view.getUint32(offset + 4, true), body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE は、中身の形式がサブフォーマットの先頭2バイトにある
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      if (!channelCount || !sampleRate || ![1, 3].includes(format) || ![8, 16, 24, 32, 64].includes(bits)) return null;
      const length = Math.min(size, view.byteLength - body), frames = Math.floor(length / (channelCount * bits / 8));
      return { sampleRate, channels: readSamples(view, body, frames, channelCount, bits, format === 3, true) };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** AIFFの標本化周波数は80bitの拡張精度浮動小数点 */
function extended(view: DataView, offset: number): number {
  const exponent = view.getUint16(offset) & 0x7fff, high = view.getUint32(offset + 2), low = view.getUint32(offset + 6);
  if (!exponent && !high && !low) return 0;
  return (high * 2 ** 32 + low) * 2 ** (exponent - 16383 - 63);
}

function parseAiff(view: DataView, aifc: boolean): PcmAudio | null {
  let offset = 12, channelCount = 0, frames = 0, bits = 0, sampleRate = 0, little = false, float = false, supported = true;
  let data: { offset: number; size: number } | null = null;
  while (offset + 8 <= view.byteLength) {
    const id = text(view, offset), size = view.getUint32(offset + 4), body = offset + 8;
    if (id === "COMM") {
      channelCount = view.getUint16(body);
      frames = view.getUint32(body + 2);
      bits = view.getUint16(body + 6);
      sampleRate = extended(view, body + 8);
      if (aifc && size >= 22) {
        const compression = text(view, body + 18);
        little = compression === "sowt";
        float = compression === "fl32" || compression === "FL32" || compression === "fl64";
        supported = ["NONE", "twos", "sowt", "fl32", "FL32", "fl64"].includes(compression);
      }
    } else if (id === "SSND") {
      data = { offset: body + 8 + view.getUint32(body), size: size - 8 };
    }
    offset = body + size + (size % 2);
  }
  if (!data || !supported || !channelCount || !sampleRate || ![8, 16, 24, 32, 64].includes(bits)) return null;
  const available = Math.floor(Math.min(data.size, view.byteLength - data.offset) / (channelCount * bits / 8));
  return { sampleRate, channels: readSamples(view, data.offset, Math.min(frames, available), channelCount, bits, float, little) };
}

export function parsePcm(bytes: ArrayBuffer): PcmAudio | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes), riff = text(view, 0), kind = text(view, 8);
  try {
    if (riff === "RIFF" && kind === "WAVE") return parseWav(view);
    if (riff === "FORM" && (kind === "AIFF" || kind === "AIFC")) return parseAiff(view, kind === "AIFC");
  } catch {
    return null;
  }
  return null;
}
