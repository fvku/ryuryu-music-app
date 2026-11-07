"use client";

import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import { parsePcm } from "@/lib/generator/pcm";
import {
  cutAudio, delayProbeSignal, effectiveRange, measureDelay, rgbaToI420, snapTenth, videoFileName,
  VIDEO_AUDIO_BITRATE, VIDEO_AUDIO_RATES, VIDEO_FPS, VIDEO_SIZE, type VideoPreference,
} from "@/lib/generator/video";
import type { MusicApi } from "./music-store";

/**
 * 画像1枚＋おすすめ曲を、ブラウザの中だけでMP4（H.264／AAC）にする。
 *
 * - 画像はジェネレーターの描画（1200／2400px）を1080pxへ縮小した静止画。30fpsで同じ絵を並べる。
 * - 音声は元のファイルを元のサンプリング周波数のまま読み、区間とフェードを掛けて AAC 320kbps にする（2026-11-08に256から変更。利用者の指示）。
 *   非可逆の圧縮はこの1回だけ（試聴用の再生とは別に読み直す。試聴用は端末の出力に合わせて周波数が変わるため）。
 * - 変換は WebCodecs（VideoEncoder／AudioEncoder）、MP4への格納は mediabunny。サーバーには何も送らない。
 */

/** 1枚の動画に必要なもの。音声はまだ読んでいない（全ページのときに曲をすべて抱えないため）。 */
export type VideoPlan = {
  page: CanvasPreviewPage;
  itemId: string;
  name: string;
  file: Blob;
  preference: VideoPreference;
};

export class VideoNotReady extends Error {
  constructor(readonly pageNumbers: number[], message: string) { super(message); }
}

export class VideoAborted extends Error {
  constructor() { super("書き出しを中止しました。"); this.name = "VideoAborted"; }
}

export function planVideo(music: MusicApi, page: CanvasPreviewPage, pngName: string): VideoPlan {
  const status = music.status(page);
  if (!status) throw new VideoNotReady([page.no], "この画像は動画にできません。");
  if (!status.ready) throw new VideoNotReady([page.no], `画像 ${page.no}: ${status.reason}`);
  const entry = music.state.audio[status.itemId];
  if (!entry) throw new VideoNotReady([page.no], `画像 ${page.no}: 音声ファイルが未設定です`);
  const slot = page.slots.find(value => value.id === status.itemId) ?? page.slots[0];
  return { page, itemId: status.itemId, name: videoFileName(pngName, slot?.fields.title || ""), file: entry.blob, preference: music.preference(status.itemId) };
}

/** 静止画なので、動きのある映像よりずっと少ない量で足りる。文字の輪郭がつぶれない程度に高めにしておく。 */
const VIDEO_BITRATE = 8_000_000;
/** キーフレームの間隔（秒）。静止画では間のフレームがほぼ0バイトなので、間隔を広げて容量を抑える。 */
const KEY_FRAME_SECONDS = 5;

const UNSUPPORTED = "このブラウザは動画の書き出しに対応していません。PCのChrome・Edge、またはSafari 26以降（iPhoneはiOS 26以降）で開いてください。";

/**
 * H.264の種類。High（画質がよい）を先に試し、出力が返らなければ Constrained Baseline にする。
 * iOSシミュレーターのSafari 26.3は、High／Mainを「対応」と答えるのに符号化が終わらず止まった（2026-11-07に実測）。
 * Baselineは1080pxでも動いた。実機のiPhoneはハードウェアでHighも作れる見込みだが、確かめるまでは実際に符号化して選ぶ。
 */
const AVC_CANDIDATES = ["avc1.640028", "avc1.42002a"] as const;
const PROBE_TIMEOUT_MS = 5000;

/** この端末で使うH.264の種類と、符号化器に渡す色の範囲。 */
type AvcChoice = { codec: string; fullRange: boolean };

/**
 * 2フレームだけ実際に符号化して、出力が返るかを見る。止まったら打ち切る。
 * あわせて、符号化器が書く色の範囲（decoderConfig.colorSpace.fullRange）を読む。
 * Safari 26.3 は渡した値をそのままフルレンジとして扱い、ファイルにも常にフルレンジと書く。
 * Chrome はテレビ用の範囲と答え、そのとおりに書く（どちらも2026-11-07に実測）。
 */
async function probeAvc(codec: string): Promise<AvcChoice | null> {
  const config: VideoEncoderConfig = { codec, width: VIDEO_SIZE, height: VIDEO_SIZE, bitrate: VIDEO_BITRATE, framerate: VIDEO_FPS, avc: { format: "avc" } };
  try {
    if (!(await VideoEncoder.isConfigSupported(config)).supported) return null;
  } catch { return null; }
  let outputs = 0, failed = false, fullRange = false;
  const encoder = new VideoEncoder({
    output: (_chunk, meta) => { outputs += 1; if (meta?.decoderConfig?.colorSpace?.fullRange) fullRange = true; },
    error: () => { failed = true; },
  });
  try {
    encoder.configure(config);
    const pixels = new Uint8Array(VIDEO_SIZE * VIDEO_SIZE * 3 / 2).fill(128);
    for (let index = 0; index < 2; index += 1) {
      const frame = new VideoFrame(pixels, { format: "I420", codedWidth: VIDEO_SIZE, codedHeight: VIDEO_SIZE, timestamp: index * 33_333, duration: 33_333 });
      encoder.encode(frame, { keyFrame: index === 0 });
      frame.close();
    }
    let timer = 0;
    const finished = await Promise.race([
      encoder.flush().then(() => true, () => false),
      new Promise<boolean>(resolve => { timer = window.setTimeout(() => resolve(false), PROBE_TIMEOUT_MS); }),
    ]);
    window.clearTimeout(timer);
    return finished && !failed && outputs > 0 ? { codec, fullRange } : null;
  } catch {
    return null;
  } finally {
    try { encoder.close(); } catch { /* 既に閉じている */ }
  }
}

let avcCheck: Promise<AvcChoice | null> | null = null;
/** この端末で実際に作れるH.264の種類と色の範囲。作れなければ null。 */
function avcChoice(): Promise<AvcChoice | null> {
  return avcCheck ??= (async () => {
    for (const codec of AVC_CANDIDATES) {
      const choice = await probeAvc(codec);
      if (choice) return choice;
    }
    return null;
  })();
}

let supportCheck: Promise<string | null> | null = null;

/** 書き出せないブラウザなら、その理由。WebCodecs が無い（古いSafariなど）か、H.264／AACを作れない（Firefoxなど）。 */
export function videoSupportProblem(): Promise<string | null> {
  return supportCheck ??= (async () => {
    if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined" || typeof VideoFrame === "undefined" || typeof AudioBuffer === "undefined") {
      return UNSUPPORTED;
    }
    if (!await avcChoice()) {
      return `このブラウザではH.264の映像を作れませんでした。${UNSUPPORTED.replace(/^このブラウザは動画の書き出しに対応していません。/, "")}`;
    }
    if (!(await audioRates()).length) {
      return "このブラウザはAACの音声を作れません（Firefoxなど）。PCのChrome・Edge、またはSafari 26以降で開いてください。";
    }
    return null;
  })().catch(error => `動画を書き出せるか確かめられませんでした: ${(error as Error).message}`);
}

/**
 * AACは固定ビットレートで指定する。Safari 26.3 は可変（既定）だと指定を無視して約93kbpsで作った
 * （同じ曲の20秒で実測。固定なら257kbps。Chromeはどちらでも250kbps。2026-11-07）。
 */
const AUDIO_QUALITY = { bitrate: VIDEO_AUDIO_BITRATE, bitrateMode: "constant" } as const;

let rates: Promise<number[]> | null = null;
/** AAC 320kbps・ステレオで作れるサンプリング周波数。 */
function audioRates(): Promise<number[]> {
  return rates ??= (async () => {
    const { canEncodeAudio, Quality } = await import("mediabunny");
    const ok: number[] = [];
    for (const sampleRate of VIDEO_AUDIO_RATES) {
      if (await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate, quality: new Quality(AUDIO_QUALITY) })) ok.push(sampleRate);
    }
    return ok;
  })();
}

const aacDelays = new Map<number, Promise<number>>();

/**
 * この端末のAAC符号化器が先頭に足す無音（プライミング）のサンプル数を、実際に符号化・復号して測る。
 * 測った分は MP4 の edit list で切り落とす（`startTimestamp` を負にすると mediabunny が書く）。
 * これをしないと、音が約48ミリ秒（44.1kHzで2112サンプル）遅れて始まる（2026-11-07にffmpegで実測）。
 * 測れなければ0（補正しない。従来どおり少し遅れるだけで、壊れはしない）。
 */
function aacDelay(sampleRate: number): Promise<number> {
  let found = aacDelays.get(sampleRate);
  if (!found) {
    found = measureAacDelay(sampleRate).catch(() => 0);
    aacDelays.set(sampleRate, found);
  }
  return found;
}

async function measureAacDelay(sampleRate: number): Promise<number> {
  const length = 16_384, onset = 4096, channels = 2;
  const signal = delayProbeSignal(length, onset, 8192);
  const planar = new Float32Array(length * channels);
  planar.set(signal, 0);
  planar.set(signal, length);

  const chunks: EncodedAudioChunk[] = [];
  let decoderConfig: AudioDecoderConfig | undefined;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => { chunks.push(chunk); if (meta?.decoderConfig) decoderConfig = meta.decoderConfig; },
    error: error => { failure = error; },
  });
  try {
    encoder.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, ...AUDIO_QUALITY });
    const data = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: length, numberOfChannels: channels, timestamp: 0, data: planar });
    encoder.encode(data);
    data.close();
    await encoder.flush();
  } finally {
    try { encoder.close(); } catch { /* 既に閉じている */ }
  }
  if (failure || !chunks.length) return 0;

  const parts: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: data => {
      try {
        const frames = data.numberOfFrames;
        if (data.format === "f32-planar") {
          const part = new Float32Array(frames);
          data.copyTo(part, { planeIndex: 0 });
          parts.push(part);
        } else if (data.format === "f32") {
          const interleaved = new Float32Array(frames * data.numberOfChannels);
          data.copyTo(interleaved, { planeIndex: 0 });
          parts.push(Float32Array.from({ length: frames }, (_, index) => interleaved[index * data.numberOfChannels]));
        } else {
          const part = new Float32Array(frames);
          data.copyTo(part, { planeIndex: 0, format: "f32-planar" });
          parts.push(part);
        }
      } finally { data.close(); }
    },
    error: error => { failure = error; },
  });
  try {
    decoder.configure(decoderConfig ?? { codec: "mp4a.40.2", sampleRate, numberOfChannels: channels });
    for (const chunk of chunks) decoder.decode(chunk);
    await decoder.flush();
  } finally {
    try { decoder.close(); } catch { /* 既に閉じている */ }
  }
  if (failure) return 0;
  const decoded = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { decoded.set(part, offset); offset += part.length; }
  return measureDelay(signal, decoded, onset, 4096, 4096) ?? 0;
}

/** 圧縮形式（MP3など）の元のサンプリング周波数。読めなければ null。 */
async function nativeSampleRate(file: Blob): Promise<number | null> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      return (await input.getPrimaryAudioTrack())?.sampleRate ?? null;
    } finally { input.dispose(); }
  } catch {
    return null;
  }
}

type Pcm = { sampleRate: number; channels: Float32Array[] };

/**
 * 音声ファイルを元の周波数のまま、非圧縮の波形にする。
 * WAV／AIFFは自前で読む（周波数がそのまま分かり、ChromeでもAIFFが読める）。それ以外はブラウザのデコーダー。
 */
async function decodeForExport(file: Blob): Promise<Pcm> {
  const bytes = await file.arrayBuffer();
  const pcm = parsePcm(bytes);
  if (pcm?.channels[0]?.length) return pcm;
  const rate = (await nativeSampleRate(file)) ?? 48_000;
  let context: OfflineAudioContext;
  try { context = new OfflineAudioContext(1, 1, rate); } catch { context = new OfflineAudioContext(1, 1, 48_000); }
  const buffer = await context.decodeAudioData(bytes);
  return { sampleRate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)) };
}

/** AACで作れない周波数（96kHzなど）だけ、作れる周波数へ変換する。切り出した後の区間だけを変換する。 */
async function toEncodableRate(audio: Pcm): Promise<Pcm> {
  const allowed = await audioRates();
  if (allowed.includes(audio.sampleRate)) return audio;
  const target = allowed.includes(48_000) ? 48_000 : allowed[0];
  const frames = audio.channels[0].length;
  const source = new AudioBuffer({ length: frames, numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate });
  audio.channels.forEach((channel, index) => source.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
  const context = new OfflineAudioContext(audio.channels.length, Math.max(1, Math.round(frames * target / audio.sampleRate)), target);
  const node = context.createBufferSource();
  node.buffer = source;
  node.connect(context.destination);
  node.start();
  const rendered = await context.startRendering();
  return { sampleRate: target, channels: Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index)) };
}

/**
 * 1080pxの正方形へ縮小する。2400pxからは半分ずつ縮めてから仕上げる
 * （一度に半分以下へ縮めると、ブラウザによっては細い線や文字の輪郭が荒れるため）。
 */
export function scaleForVideo(source: HTMLCanvasElement): HTMLCanvasElement {
  let current: HTMLCanvasElement = source;
  const temporary: HTMLCanvasElement[] = [];
  const draw = (from: HTMLCanvasElement, size: number) => {
    const canvas = window.document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("縮小用の描画領域を準備できませんでした。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(from, 0, 0, size, size);
    return canvas;
  };
  try {
    while (current.width >= VIDEO_SIZE * 2) {
      current = draw(current, Math.floor(current.width / 2));
      temporary.push(current);
    }
    return draw(current, VIDEO_SIZE);
  } finally {
    for (const canvas of temporary) { canvas.width = 0; canvas.height = 0; }
  }
}

export type VideoProgress = { phase: "audio" | "encode"; ratio: number };

/** 縮小済みの画像と音声の区間から、MP4を作る。 */
async function encodeMp4(image: HTMLCanvasElement, audio: Pcm, onProgress: (progress: VideoProgress) => void, shouldAbort: () => boolean): Promise<Blob> {
  const { AudioBufferSource, BufferTarget, Mp4OutputFormat, Output, Quality, VideoSample, VideoSampleSource } = await import("mediabunny");
  const frames = audio.channels[0].length;
  const seconds = frames / audio.sampleRate;
  const frameCount = Math.max(1, Math.round(seconds * VIDEO_FPS));

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const avc = await avcChoice();
  if (!avc) throw new Error("このブラウザではH.264の映像を作れませんでした。");
  const video = new VideoSampleSource({ codec: "avc", fullCodecString: avc.codec, quality: new Quality({ bitrate: VIDEO_BITRATE }), keyFrameInterval: KEY_FRAME_SECONDS, latencyMode: "quality" });
  // 先頭の無音（プライミング）の分だけ早い時刻から置き、0秒より前を edit list で切り落とす。
  const delay = await aacDelay(audio.sampleRate);
  const sound = new AudioBufferSource({ codec: "aac", quality: new Quality(AUDIO_QUALITY) }, { startTimestamp: -delay / audio.sampleRate });
  output.addVideoTrack(video, { frameRate: VIDEO_FPS });
  output.addAudioTrack(sound);

  let sample: InstanceType<typeof VideoSample> | null = null;
  try {
    await output.start();
    const buffer = new AudioBuffer({ length: frames, numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate });
    audio.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
    await sound.add(buffer);
    sound.close();

    // 同じ絵を1枚だけ取り込み、時刻だけ変えて並べる（毎フレーム描画領域から読み直さない）。
    // 色の変換は自前で行い、BT.709と色の範囲を明示する（rgbaToI420 と probeAvc の説明を参照）。
    const pixels = image.getContext("2d")?.getImageData(0, 0, image.width, image.height).data;
    if (!pixels) throw new Error("画像の画素を読めませんでした。");
    sample = new VideoSample(rgbaToI420(pixels, image.width, image.height, avc.fullRange), {
      format: "I420",
      codedWidth: image.width,
      codedHeight: image.height,
      timestamp: 0,
      duration: 1 / VIDEO_FPS,
      colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: avc.fullRange },
    });
    for (let index = 0; index < frameCount; index += 1) {
      if (shouldAbort()) throw new VideoAborted();
      sample.setTimestamp(index / VIDEO_FPS);
      await video.add(sample);
      if (index % 15 === 0) onProgress({ phase: "encode", ratio: (index + 1) / frameCount });
    }
    video.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    sample?.close();
  }
  const bytes = output.target.buffer;
  if (!bytes) throw new Error("動画のデータを受け取れませんでした。");
  onProgress({ phase: "encode", ratio: 1 });
  return new Blob([bytes], { type: "video/mp4" });
}

export type BuiltVideo = { file: File; seconds: number; trimmed: boolean };

/**
 * 1枚分の動画を作る。`image` は描画済みのページ（1200／2400px）。縮小した写しを使うので、呼び出し側で解放してよい。
 * 音声は区間を切り出した分だけを持つ（曲全体の波形はここを抜けたら手放す）。
 */
export async function buildVideo({ plan, image, onProgress, shouldAbort = () => false }: {
  plan: VideoPlan;
  image: HTMLCanvasElement;
  onProgress(progress: VideoProgress): void;
  shouldAbort?(): boolean;
}): Promise<BuiltVideo> {
  const problem = await videoSupportProblem();
  if (problem) throw new Error(problem);
  const still = scaleForVideo(image);
  try {
    onProgress({ phase: "audio", ratio: 0 });
    let section: Pcm, range: ReturnType<typeof effectiveRange>;
    {
      const whole = await decodeForExport(plan.file).catch(() => {
        throw new VideoNotReady([plan.page.no], `画像 ${plan.page.no}: 音声ファイルを読み込めませんでした。`);
      });
      range = effectiveRange(plan.preference, whole.channels[0].length / whole.sampleRate);
      section = { sampleRate: whole.sampleRate, channels: cutAudio(whole.channels, whole.sampleRate, { ...range, fadeIn: plan.preference.fadeIn, fadeOut: plan.preference.fadeOut }) };
    }
    if (!section.channels[0]?.length) throw new VideoNotReady([plan.page.no], `画像 ${plan.page.no}: 音声の区間が空です。`);
    section = await toEncodableRate(section);
    if (shouldAbort()) throw new VideoAborted();
    const blob = await encodeMp4(still, section, onProgress, shouldAbort);
    return { file: new File([blob], plan.name, { type: "video/mp4" }), seconds: snapTenth(range.length), trimmed: range.trimmed };
  } finally {
    still.width = 0; still.height = 0;
  }
}

/**
 * 進捗の文言。「音声を準備しています…」→「動画を作っています… 40%」。
 * Safari はタブが裏に回ると変換が止まる（表に戻すと続きから再開する。2026-11-07 Mac Safari 26.3 で実測）ので、表示したままにするよう添える。
 */
export function progressText(progress: VideoProgress, prefix = ""): string {
  return progress.phase === "audio"
    ? `${prefix}音声を準備しています…（終わるまでこのタブを表示したままにしてください）`
    : `${prefix}動画を作っています… ${Math.round(progress.ratio * 100)}%（このタブを表示したままに）`;
}

/** ファイルとして保存する（PNGの書き出しと同じ方法）。 */
export function downloadFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file), anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
