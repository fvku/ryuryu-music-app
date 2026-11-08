/** 1フレーム進める・戻す幅。動画のfpsはブラウザから取れないので30fps相当で動かす。 */
export const FRAME_STEP = 1 / 30;

const MAX_CACHED_FRAMES = 16;
const LOAD_TIMEOUT = 20_000;
const SEEK_TIMEOUT = 15_000;

function wait(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms));
}

/**
 * 背景に使う動画から、指定した時刻の静止画を取り出す。
 * 動画要素は1つなのでシークは順番待ちにする。スライダーを動かしている間に積まれた古い要求は、
 * 順番が来たときに isStale で捨てる（全部シークすると操作に追いつかない）。
 */
export class VideoFrameSource {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<number, HTMLCanvasElement>();
  private closed = false;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
    /** 利用者が手元から選んだ動画のときだけファイル名が入る。 */
    readonly fileName: string | null,
  ) {}

  get duration() { return this.video.duration; }

  /** アプリに同梱した動画を開く。同じオリジンなのでCanvasへ描ける。 */
  static openUrl(url: string): Promise<VideoFrameSource> {
    return VideoFrameSource.load(url, null);
  }

  static openFile(file: File): Promise<VideoFrameSource> {
    return VideoFrameSource.load(URL.createObjectURL(file), file.name);
  }

  private static async load(url: string, fileName: string | null): Promise<VideoFrameSource> {
    const video = window.document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT);
        video.addEventListener("loadeddata", () => { window.clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener("error", () => { window.clearTimeout(timer); reject(new Error("decode")); }, { once: true });
        video.src = url;
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) throw new Error("metadata");
      // iOS Safari は一度再生を始めないと、シーク後のフレームを描けないことがある。
      await video.play().catch(() => {});
      video.pause();
      return new VideoFrameSource(video, url, fileName);
    } catch {
      if (fileName !== null) URL.revokeObjectURL(url);
      throw new Error("この動画を読み込めませんでした。MP4（H.264）で書き出した動画をお試しください。");
    }
  }

  /** 指定時刻の静止画。古くなった要求や閉じた後の要求には null を返す。 */
  grab(time: number, isStale?: () => boolean): Promise<HTMLCanvasElement | null> {
    const clamped = Math.max(0, Math.min(time, this.duration - 0.05));
    const key = Math.round(clamped * 1000);
    const cached = this.remember(key);
    if (cached) return Promise.resolve(cached);
    const task = this.chain.then(async () => {
      if (this.closed || isStale?.()) return null;
      const ready = this.remember(key);
      if (ready) return ready;
      await this.seek(clamped);
      if (this.closed) return null;
      const frame = this.capture();
      this.cache.set(key, frame);
      if (this.cache.size > MAX_CACHED_FRAMES) this.cache.delete(this.cache.keys().next().value as number);
      return frame;
    });
    this.chain = task.catch(() => {});
    return task;
  }

  close() {
    this.closed = true;
    this.cache.clear();
    this.video.removeAttribute("src");
    this.video.load();
    if (this.fileName !== null) URL.revokeObjectURL(this.url);
  }

  /** 使ったフレームを末尾へ移し、古いものから捨てられるようにする。 */
  private remember(key: number): HTMLCanvasElement | null {
    const frame = this.cache.get(key);
    if (!frame) return null;
    this.cache.delete(key);
    this.cache.set(key, frame);
    return frame;
  }

  private async seek(time: number) {
    const { video } = this;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("動画のフレームを読み込めませんでした。")), SEEK_TIMEOUT);
      video.addEventListener("seeked", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      video.currentTime = time;
    });
    // seeked の時点では前のフレームが残っているブラウザがある。同じフレームなら通知が来ないので時間で打ち切る。
    if (typeof video.requestVideoFrameCallback === "function") {
      await Promise.race([new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve())), wait(120)]);
    }
  }

  /** 画像より大きい解像度は要らないので、背景を覆える大きさまで縮めて持つ。 */
  private capture(): HTMLCanvasElement {
    const { video } = this;
    const scale = Math.min(1, Math.max(1080 / video.videoWidth, 1920 / video.videoHeight));
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("描画領域を準備できませんでした。");
    context.imageSmoothingQuality = "high";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
}
