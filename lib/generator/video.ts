/**
 * 動画書き出し（画像1枚＋おすすめ曲）の、描画にもDBにも依存しない計算。
 * 音声ファイルは端末の中だけで使い、共有データには何も保存しない。
 */

/** Instagramのフィードは60秒未満。これまでKeynoteで作ってきた長さを既定にする。 */
export const VIDEO_DEFAULT_SECONDS = 59;
export const VIDEO_MAX_SECONDS = 59;
export const VIDEO_MIN_SECONDS = 1;
/** フィード用の正方形。元画像（1200／2400）から縮小する。 */
export const VIDEO_SIZE = 1080;

/** 頭のフェードイン・終わりのフェードアウトの長さ（秒）。試聴と書き出しで同じ値を使う。 */
export const FADE_IN_SECONDS = 1;
export const FADE_OUT_SECONDS = 2;
/** 静止画でも、Instagramが普通の動画として扱うフレームレートにする（Keynoteの書き出しと同じ30fps）。 */
export const VIDEO_FPS = 30;
/** 書き出す音声。非可逆の圧縮はここで1回だけ（元のMP3 → AAC）。 */
export const VIDEO_AUDIO_BITRATE = 256_000;
/** AACの符号化で確実に通るサンプリング周波数。それ以外（96kHzのWAVなど）は48kHzへ変換する。 */
export const VIDEO_AUDIO_RATES = [44_100, 48_000] as const;

/** `1:03`・`01:03`・`1:03.5`・`63` を秒へ。読めなければ null。 */
export function parseClock(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const clock = text.match(/^(\d{1,3}):([0-5]?\d(?:\.\d+)?)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return null;
}

/** 秒を `m:ss` へ。`tenths` なら0.1秒単位（端数が無ければ省く）。それ以外は切り捨て。 */
export function formatClock(seconds: number, tenths = false): string {
  const value = Math.max(0, seconds);
  if (tenths) {
    const scaled = Math.round(value * 10), whole = Math.floor(scaled / 10), fraction = scaled % 10;
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
  }
  const total = Math.floor(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 0.1秒単位に丸める。ドラッグ・キー操作・数値入力の値をそろえる。 */
export function snapTenth(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}

export type VideoRange = { start: number; length: number };

/**
 * 実際に使う区間。開始は曲の中へ、長さは1〜59秒へ収め、曲の終わりを越える分は削る。
 * `trimmed` は曲の終わりで短くなったかどうか（画面で知らせる）。
 */
export function effectiveRange(range: VideoRange, trackSeconds: number | null): VideoRange & { trimmed: boolean } {
  const length = Math.min(VIDEO_MAX_SECONDS, Math.max(VIDEO_MIN_SECONDS, snapTenth(range.length)));
  if (trackSeconds === null || !Number.isFinite(trackSeconds) || trackSeconds <= 0) return { start: Math.max(0, range.start), length, trimmed: false };
  const start = Math.min(Math.max(0, range.start), Math.max(0, trackSeconds - VIDEO_MIN_SECONDS));
  const available = trackSeconds - start;
  return available < length ? { start, length: snapTenth(available), trimmed: true } : { start, length, trimmed: false };
}

/**
 * 波形の上で範囲をドラッグしたときの新しい範囲。
 * move は長さを保ったまま動かし、start は終わりを固定して頭を、end は頭を固定して終わりを動かす。
 */
export type RangeDragMode = "move" | "start" | "end";

export function dragRange(origin: VideoRange, mode: RangeDragMode, deltaSeconds: number, trackSeconds: number): VideoRange {
  const track = Math.max(VIDEO_MIN_SECONDS, trackSeconds);
  if (mode === "move") {
    const length = Math.min(origin.length, track);
    return { start: snapTenth(Math.min(Math.max(0, origin.start + deltaSeconds), track - length)), length };
  }
  if (mode === "start") {
    const end = Math.min(origin.start + origin.length, track);
    const start = snapTenth(Math.min(Math.max(Math.max(0, end - VIDEO_MAX_SECONDS), origin.start + deltaSeconds), end - VIDEO_MIN_SECONDS));
    return { start, length: snapTenth(end - start) };
  }
  const length = snapTenth(Math.min(Math.max(VIDEO_MIN_SECONDS, origin.length + deltaSeconds), Math.min(VIDEO_MAX_SECONDS, track - origin.start)));
  return { start: origin.start, length };
}

/** 手で変えた開始・長さ・フェードを、このブラウザだけに覚えておく。共有データには入れない。 */
export type VideoPreference = { start: number; length: number; fadeIn: boolean; fadeOut: boolean };

export function videoPreferenceKey(documentId: string, itemId: string): string {
  return `ryuryu_generator_video:v1:${documentId}:${itemId}`;
}

/** 掲載ページで、上下どちらの作品の曲を使うか。ページごとにこのブラウザへ覚える。 */
export function videoChoiceKey(documentId: string, pageId: string): string {
  return `ryuryu_generator_video_choice:v1:${documentId}:${pageId}`;
}

export function parseVideoPreference(raw: string | null): VideoPreference | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<VideoPreference>;
    if (typeof value.start !== "number" || typeof value.length !== "number" || !Number.isFinite(value.start) || !Number.isFinite(value.length)) return null;
    return { start: Math.max(0, value.start), length: value.length, fadeIn: value.fadeIn === true, fadeOut: value.fadeOut === true };
  } catch {
    return null;
  }
}

/** Release Master の Start Time を引くための作品の手がかり。照合順は UID → No. → 作品名＋アーティスト。 */
export type StartTimeQuery = { id: string; uid: string | null; no: string | null; title: string; artist: string };
export type StartTimeAlbum = { uid: string; no: string; title: string; artist: string; mjTrackNo: string; mjTrack: string; mjStartTime: string };
export type StartTimeHit = { startTime: string; trackNo: string; track: string };

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function matchStartTimes(queries: StartTimeQuery[], albums: StartTimeAlbum[]): Record<string, StartTimeHit> {
  const byUid = new Map<string, StartTimeAlbum>(), byNo = new Map<string, StartTimeAlbum>(), byName = new Map<string, StartTimeAlbum>();
  for (const album of albums) {
    if (album.uid.trim() && !byUid.has(album.uid.trim())) byUid.set(album.uid.trim(), album);
    if (album.no.trim() && !byNo.has(album.no.trim())) byNo.set(album.no.trim(), album);
    const name = `${normalize(album.title)}\u0000${normalize(album.artist)}`;
    if (!byName.has(name)) byName.set(name, album);
  }
  const result: Record<string, StartTimeHit> = {};
  for (const query of queries) {
    const album = (query.uid?.trim() && byUid.get(query.uid.trim()))
      || (query.no?.trim() && byNo.get(query.no.trim()))
      || byName.get(`${normalize(query.title)}\u0000${normalize(query.artist)}`);
    if (album) result[query.id] = { startTime: album.mjStartTime.trim(), trackNo: album.mjTrackNo.trim(), track: album.mjTrack.trim() };
  }
  return result;
}

/** 書き出すファイル名。PNGと並べたときに同じ画像だと分かるよう、番号と作品名を入れる。 */
export function videoFileName(pngName: string, title: string): string {
  const base = pngName.replace(/\.png$/i, "");
  const safe = title.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, "-").slice(0, 40);
  return `${base}${safe ? `_${safe}` : ""}.mp4`;
}

/**
 * 波形表示用の、区間ごとの音の大きさ（0〜1）。
 * 最大振幅だと、音圧の高い今の曲はほぼ全区間が1に張りついて平らに見える。
 * そこで区間の実効値（RMS）をdBにし、曲の中の静かな側（下位10%）〜最大の幅へ広げて、サビなどの盛り上がりが見えるようにする。
 */
export function waveformLevels(channels: Float32Array[], buckets: number): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length || buckets < 1) return [];
  const size = Math.max(1, Math.floor(length / buckets)), decibels: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = bucket * size, to = bucket === buckets - 1 ? length : Math.min(length, from + size);
    // 1区間あたり最大4000点だけ見る。長い曲でも開いた瞬間に固まらないため。
    const step = Math.max(1, Math.floor((to - from) / 4000));
    let sum = 0, count = 0;
    for (const channel of channels) for (let index = from; index < to; index += step) { sum += channel[index] * channel[index]; count += 1; }
    const rms = count ? Math.sqrt(sum / count) : 0;
    decibels.push(20 * Math.log10(Math.max(rms, 1e-5)));
  }
  const sorted = [...decibels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)], top = sorted[sorted.length - 1];
  // 全体がほぼ同じ大きさ（無音・一定のトーン）なら、差を作らずに中ほどの高さで出す
  if (top - floor < 1) return decibels.map(value => (value <= -90 ? 0.04 : 0.6));
  return decibels.map(value => {
    const ratio = Math.min(1, Math.max(0, (value - floor) / (top - floor)));
    return 0.06 + 0.94 * Math.pow(ratio, 1.6);
  });
}

/** フェードを掛けた区間の音量（0〜1）。試聴（Web Audioの直線ランプ）と同じ形。 */
export function fadeGain(time: number, length: number, fadeIn: boolean, fadeOut: boolean): number {
  let gain = 1;
  if (fadeIn) gain = Math.min(gain, Math.max(0, time / Math.min(FADE_IN_SECONDS, length)));
  if (fadeOut) {
    const from = Math.max(0, length - FADE_OUT_SECONDS);
    if (time > from) gain = Math.min(gain, Math.max(0, (length - time) / (length - from)));
  }
  return Math.min(1, gain);
}

/**
 * 曲から書き出す区間を切り出し、フェードを掛けたステレオ2ch（L, R）を返す。
 * 1chはL・Rへ複製し、3ch以上は先頭の2chを使う。曲の終わりを越える分は無音で埋めず、短くなる。
 */
export function cutAudio(channels: Float32Array[], sampleRate: number, range: VideoRange & { fadeIn: boolean; fadeOut: boolean }): Float32Array[] {
  const total = channels[0]?.length ?? 0;
  const from = Math.min(total, Math.max(0, Math.round(range.start * sampleRate)));
  const to = Math.min(total, from + Math.max(0, Math.round(range.length * sampleRate)));
  const count = to - from, length = count / sampleRate;
  const sources = channels.length >= 2 ? channels.slice(0, 2) : [channels[0], channels[0]];
  return sources.map(source => {
    const out = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const gain = range.fadeIn || range.fadeOut ? fadeGain(index / sampleRate, length, range.fadeIn, range.fadeOut) : 1;
      out[index] = (source?.[from + index] ?? 0) * gain;
    }
    return out;
  });
}

/** 遅延を測るための雑音（同じ種から毎回同じ列を作る）。`onset` から `count` サンプルだけ鳴り、ほかは無音。 */
export function delayProbeSignal(length: number, onset: number, count: number): Float32Array<ArrayBuffer> {
  const signal = new Float32Array(length);
  let seed = 0x2545f491;
  for (let index = onset; index < Math.min(length, onset + count); index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    signal[index] = (seed / 0x1_0000_0000 - 0.5) * 0.8;
  }
  return signal;
}

/**
 * 符号化→復号した音が、元よりどれだけ遅れているか（サンプル数）。0〜maxLag で相関が最大の位置。
 * AACは先頭に「プライミング」と呼ばれる無音を足す（AudioToolboxは2112サンプル）。その分を後で切り落とすために測る。
 * はっきりした一致が無ければ null（測れなかったものとして扱い、補正しない）。
 */
export function measureDelay(reference: Float32Array, decoded: Float32Array, onset: number, window: number, maxLag: number): number | null {
  let best = { lag: -1, score: 0 };
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let dot = 0, energyA = 0, energyB = 0;
    for (let index = 0; index < window; index += 2) {
      const a = reference[onset + index] ?? 0, b = decoded[onset + lag + index] ?? 0;
      dot += a * b; energyA += a * a; energyB += b * b;
    }
    const score = energyA > 0 && energyB > 0 ? dot / Math.sqrt(energyA * energyB) : 0;
    if (score > best.score) best = { lag, score };
  }
  return best.score >= 0.5 ? best.lag : null;
}

/**
 * RGBA（キャンバスの画素）を、H.264で使う形式（BT.709・I420）へ変換する。既定はテレビ用の範囲（16〜235）。
 * 色の変換をブラウザに任せると、Safari 26.3 はテレビ用の範囲の値で作りながら「フルレンジ」と書き、
 * 再生すると黒が浮いて全体が明るくなった（2026-11-07に実測）。自前で変換し、符号化器に合わせた範囲で渡す。
 * 色差（Cb・Cr）は2×2画素の平均。幅・高さは偶数であること。
 */
export function rgbaToI420(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, fullRange = false): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height * 3 / 2);
  // テレビ用の範囲は Y 16〜235・色差 16〜240、フルレンジは どちらも 0〜255。
  const yBase = fullRange ? 0 : 16, yScale = fullRange ? 255 : 219, cScale = fullRange ? 255 : 224;
  const chromaWidth = width / 2, uOffset = width * height, vOffset = uOffset + chromaWidth * (height / 2);
  const kr = 0.2126, kb = 0.0722, kg = 1 - kr - kb;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let sumR = 0, sumG = 0, sumB = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const at = ((y + dy) * width + x + dx) * 4;
          const r = rgba[at] / 255, g = rgba[at + 1] / 255, b = rgba[at + 2] / 255;
          out[(y + dy) * width + x + dx] = Math.round(yBase + yScale * (kr * r + kg * g + kb * b));
          sumR += r; sumG += g; sumB += b;
        }
      }
      const r = sumR / 4, g = sumG / 4, b = sumB / 4, luma = kr * r + kg * g + kb * b;
      const index = (y / 2) * chromaWidth + x / 2;
      out[uOffset + index] = Math.min(255, Math.round(128 + cScale * (b - luma) / (2 * (1 - kb))));
      out[vOffset + index] = Math.min(255, Math.round(128 + cScale * (r - luma) / (2 * (1 - kr))));
    }
  }
  return out;
}
