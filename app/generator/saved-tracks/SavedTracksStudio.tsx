"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import {
  addedDateInTokyo,
  cleanTrackTitle,
  defaultFrameTime,
  groupByAddedDate,
  initialSelection,
  SAVED_TRACKS_VIDEO_URL,
  STILL_BACKGROUNDS,
  storyArchiveName,
  storyFileName,
  type SavedTrack,
} from "@/lib/generator/saved-tracks";
import { getArchivePacker } from "../bulk-export";
import { generatorJson, type GeneratorApiError } from "../generator-client";
import { Checkbox, Chip, Field, Panel, PanelHeading, PrimaryButton, SecondaryButton, StatusBanner, TextInput, type Tone } from "../ui";
import { drawStory, ensureStoryFonts, loadJacket, loadStoryImages, type StoryBackground } from "./story-canvas";
import { FRAME_STEP, VideoFrameSource } from "./video-frames";

type Status = { tone: Tone; text: string };
type SlideEdit = { title?: string; artist?: string; pan?: number; time?: number };
type Slide = { track: SavedTrack; index: number; title: string; artist: string; pan?: number; time?: number };

const PREVIEW_SCALE = 0.75;
const THUMB_SCALE = 0.15;
const dateLabel = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC" });
const noSubscription = () => () => {};

function groupTitle(date: string) {
  return dateLabel.format(new Date(`${date}T00:00:00.000Z`));
}

function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

function resolvedTime(slide: Pick<Slide, "index" | "time">, video: VideoFrameSource) {
  return slide.time ?? defaultFrameTime(slide.index, video.duration);
}

async function backgroundOf(
  slide: Pick<Slide, "index" | "pan" | "time">,
  video: VideoFrameSource | null,
  isStale?: () => boolean,
): Promise<StoryBackground | null> {
  if (video) {
    const frame = await video.grab(resolvedTime(slide, video), isStale);
    return frame && { source: frame, width: frame.width, height: frame.height, pan: slide.pan ?? 0.5 };
  }
  const still = STILL_BACKGROUNDS[slide.index % STILL_BACKGROUNDS.length];
  const image = (await loadStoryImages()).stills[still.key];
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, pan: slide.pan ?? still.pan };
}

/** 素材をそろえて1枚をキャンバスへ描く。古くなった描画は途中で捨てる。戻り値は文字を省略したかどうか。 */
async function paint(
  canvas: HTMLCanvasElement,
  slide: Pick<Slide, "index" | "title" | "artist" | "pan" | "time"> & { coverUrl: string },
  video: VideoFrameSource | null,
  scale: number,
  isStale?: () => boolean,
): Promise<boolean | null> {
  const [images, jacket, background] = await Promise.all([
    loadStoryImages(),
    loadJacket(slide.coverUrl),
    backgroundOf(slide, video, isStale),
    ensureStoryFonts([slide.title, slide.artist]),
  ]);
  if (!background || isStale?.()) return null;
  const width = Math.round(1080 * scale), height = Math.round(1920 * scale);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("描画領域を準備できませんでした。");
  return drawStory(context, { background, jacket, title: slide.title, artist: slide.artist }, images, scale);
}

function StoryCanvas({
  slide,
  video,
  waiting,
  scale,
  className,
  onDrawn,
  onError,
}: {
  slide: Slide;
  video: VideoFrameSource | null;
  /** 背景動画の読み込み中は描かない。先に静止画を出すと、読み込み後に背景が差し替わって見える。 */
  waiting: boolean;
  scale: number;
  className?: string;
  onDrawn?(truncated: boolean): void;
  onError(message: string): void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onDrawn, onError });
  useEffect(() => { callbacks.current = { onDrawn, onError }; });
  const { index, title, artist, pan, time } = slide, coverUrl = slide.track.coverUrl;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || waiting) return;
    let stale = false;
    paint(canvas, { index, title, artist, pan, time, coverUrl }, video, scale, () => stale)
      .then(truncated => { if (!stale && truncated !== null) callbacks.current.onDrawn?.(truncated); })
      .catch((error: Error) => { if (!stale) callbacks.current.onError(error.message); });
    return () => { stale = true; };
  }, [index, title, artist, pan, time, coverUrl, video, waiting, scale]);

  return <canvas ref={ref} width={Math.round(1080 * scale)} height={Math.round(1920 * scale)} className={className} />;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("PNGを作成できませんでした。"))), "image/png");
  });
}

export default function SavedTracksStudio({
  initialTracks,
  initialError,
  initiallyNeedsLogin,
}: {
  initialTracks: SavedTrack[];
  initialError: string | null;
  initiallyNeedsLogin: boolean;
}) {
  const [tracks, setTracks] = useState(initialTracks);
  const [selected, setSelected] = useState(() => new Set(initialSelection(initialTracks)));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, SlideEdit>>({});
  const [video, setVideo] = useState<VideoFrameSource | null>(null);
  const [videoLoading, setVideoLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(initialError ? { tone: "error", text: initialError } : null);
  const [needsLogin, setNeedsLogin] = useState(initiallyNeedsLogin);
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const canShare = useSyncExternalStore(noSubscription, () => typeof navigator.canShare === "function", () => false);

  useEffect(() => () => video?.close(), [video]);

  useEffect(() => {
    let cancelled = false;
    VideoFrameSource.openUrl(SAVED_TRACKS_VIDEO_URL)
      .then(source => {
        if (cancelled) { source.close(); return; }
        setVideo(source);
        setVideoLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setVideoLoading(false);
        setStatus({ tone: "warn", text: "背景動画を読み込めなかったため、標準の写真を使っています。" });
      });
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => groupByAddedDate(tracks), [tracks]);
  const slides = useMemo<Slide[]>(() => tracks.filter(track => selected.has(track.id)).map((track, index) => {
    const edit = edits[track.id];
    return { track, index, title: edit?.title ?? cleanTrackTitle(track.title), artist: edit?.artist ?? track.artist, pan: edit?.pan, time: edit?.time };
  }), [tracks, selected, edits]);
  const active = slides.find(slide => slide.track.id === activeId) ?? slides[0] ?? null;
  const reportError = (message: string) => setStatus({ tone: "error", text: message });

  function toggle(track: SavedTrack, checked: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      if (checked) next.add(track.id); else next.delete(track.id);
      return next;
    });
    if (checked) setActiveId(track.id);
  }

  function edit(id: string, patch: SlideEdit) {
    setEdits(previous => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  }

  async function reload() {
    setBusy(true);
    try {
      const next = await generatorJson<SavedTrack[]>(await fetch("/api/generator/saved-tracks", { cache: "no-store" }));
      setTracks(next);
      setSelected(previous => (previous.size > 0 ? previous : new Set(initialSelection(next))));
      setNeedsLogin(false);
      setStatus({ tone: "success", text: `プレイリストを読み込みました（${next.length}曲）。` });
    } catch (error) {
      const value = error as GeneratorApiError;
      setNeedsLogin(value.status === 401);
      reportError(value.message);
    } finally {
      setBusy(false);
    }
  }

  async function switchVideo(open: () => Promise<VideoFrameSource>, done: string) {
    setBusy(true);
    setStatus({ tone: "info", text: "動画を読み込んでいます…" });
    try {
      const source = await open();
      // 前の動画のフレームや位置を持ち越すと、別の動画で意味が変わる。
      setEdits(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, { title: value.title, artist: value.artist }])));
      setVideo(source);
      setStatus({ tone: "success", text: done });
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function dateOf(slide: Slide) {
    return addedDateInTokyo(slide.track.addedAt);
  }

  async function renderBlob(slide: Slide): Promise<Blob> {
    const canvas = window.document.createElement("canvas");
    try {
      await paint(canvas, { ...slide, coverUrl: slide.track.coverUrl }, video, 1);
      return await canvasBlob(canvas);
    } finally {
      canvas.width = canvas.height = 0;
    }
  }

  async function exportOne(slide: Slide, share: boolean) {
    setBusy(true);
    setStatus({ tone: "info", text: "PNGを生成しています…" });
    try {
      const blob = await renderBlob(slide), name = storyFileName(dateOf(slide), slide.index + 1);
      const file = new File([blob], name, { type: "image/png" });
      const shared = share && Boolean(navigator.canShare?.({ files: [file] }));
      if (shared) await navigator.share({ files: [file], title: name });
      else downloadBlob(blob, name);
      setStatus({ tone: "success", text: `${name} を${shared ? "アプリへ送りました" : "書き出しました"}。` });
    } catch (error) {
      const value = error as Error;
      if (value.name === "AbortError") setStatus(null);
      else reportError(`PNGを書き出せませんでした: ${value.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportAll() {
    const packer = getArchivePacker();
    if (!packer || slides.length === 0) return;
    setBusy(true);
    try {
      const date = dateOf(slides[0]), entries = [];
      for (const [position, slide] of slides.entries()) {
        setStatus({ tone: "info", text: `PNGを生成しています… ${position + 1}/${slides.length}` });
        entries.push({ name: storyFileName(date, slide.index + 1), blob: await renderBlob(slide) });
      }
      const name = storyArchiveName(date);
      downloadBlob(await packer(entries), name);
      setStatus({ tone: "success", text: `${name} に${entries.length}枚を保存しました。` });
    } catch (error) {
      reportError(`書き出せませんでした: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const activeTime = active && video ? resolvedTime(active, video) : 0;
  const activePan = active ? active.pan ?? (video ? 0.5 : STILL_BACKGROUNDS[active.index % STILL_BACKGROUNDS.length].pan) : 0.5;
  const stepFrame = (direction: number) => {
    if (!active || !video) return;
    edit(active.track.id, { time: Math.max(0, Math.min(video.duration, activeTime + direction * FRAME_STEP)) });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/generator" className="inline-block text-xs text-violet-300 hover:underline">← 投稿画像ジェネレーター</Link>
      <div>
        <h1 className="text-2xl font-bold">Saved Tracks Stories画像</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>プレイリストから曲を選ぶと、ストーリー用の画像（1080×1920）ができます。</p>
      </div>

      {status && (
        <StatusBanner
          tone={status.tone}
          actions={needsLogin ? <SecondaryButton onClick={() => signIn("google", { callbackUrl: "/generator/saved-tracks" })}>Googleでログインし直す</SecondaryButton> : undefined}
        >
          {status.text}
        </StatusBanner>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel padding="tight" className="lg:sticky lg:top-4">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <h2 className="text-sm font-semibold">曲を選ぶ <span className="font-normal" style={{ color: "var(--text-secondary)" }}>{slides.length}曲</span></h2>
            <SecondaryButton disabled={busy} onClick={() => void reload()} className="min-h-9 px-3 text-xs">再読込</SecondaryButton>
          </div>
          <div className="max-h-[32rem] overflow-y-auto lg:max-h-[calc(100vh-9rem)]">
            {groups.length === 0 && <p className="p-2 text-sm" style={{ color: "var(--text-secondary)" }}>曲がありません。</p>}
            {groups.map((group, groupIndex) => (
              <details key={group.date} open={groupIndex === 0} className="mb-1">
                <summary className="cursor-pointer rounded-lg px-1 py-2 text-xs font-semibold">
                  {groupTitle(group.date)} に追加 <span className="font-normal" style={{ color: "var(--text-secondary)" }}>{group.tracks.length}曲</span>
                </summary>
                <ul>
                  {group.tracks.map(track => (
                    <li key={track.id} className="px-1">
                      <Checkbox
                        checked={selected.has(track.id)}
                        onChange={event => toggle(track, event.target.checked)}
                        label={(
                          <span className="flex min-w-0 items-center gap-2.5 py-1">
                            {/* eslint-disable-next-line @next/next/no-img-element -- Spotifyの小さな画像を直接表示する */}
                            <img src={track.thumbUrl} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm">{track.title}</span>
                              <span className="block truncate text-xs" style={{ color: "var(--text-secondary)" }}>{track.artist}</span>
                            </span>
                          </span>
                        )}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </Panel>

        <div className="min-w-0 space-y-4">
          {!active ? (
            <Panel><p className="text-sm" style={{ color: "var(--text-secondary)" }}>左の一覧から曲を選んでください。</p></Panel>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1" aria-label="画像の一覧">
                {slides.map(slide => (
                  <button
                    key={slide.track.id}
                    type="button"
                    onClick={() => setActiveId(slide.track.id)}
                    aria-label={`画像 ${slide.index + 1}: ${slide.title}`}
                    aria-current={slide.track.id === active.track.id}
                    className={`relative shrink-0 overflow-hidden rounded-lg border-2 ${slide.track.id === active.track.id ? "border-violet-500" : "border-transparent"}`}
                  >
                    <StoryCanvas slide={slide} video={video} waiting={videoLoading} scale={THUMB_SCALE} className="block h-[7.1rem] w-16 bg-white/5" onError={reportError} />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] leading-4">{slide.index + 1}</span>
                  </button>
                ))}
              </div>

              <div className="grid items-start gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                <div className="mx-auto w-full max-w-[20rem]">
                  <StoryCanvas
                    slide={active}
                    video={video}
                    waiting={videoLoading}
                    scale={PREVIEW_SCALE}
                    className="block w-full rounded-xl bg-white/5"
                    onDrawn={setTruncated}
                    onError={reportError}
                  />
                </div>

                <div className="min-w-0 space-y-4">
                  <Panel>
                    <PanelHeading title={`画像 ${active.index + 1}`} chips={truncated ? <Chip tone="warn">文字を省略しています</Chip> : undefined} />
                    <div className="space-y-3">
                      <Field label="曲名">
                        <TextInput value={active.title} onChange={event => edit(active.track.id, { title: event.target.value })} />
                      </Field>
                      <Field label="アーティスト名">
                        <TextInput value={active.artist} onChange={event => edit(active.track.id, { artist: event.target.value })} />
                      </Field>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <PrimaryButton disabled={busy || videoLoading} onClick={() => void exportOne(active, false)}>PNGを書き出す</PrimaryButton>
                      {canShare && <SecondaryButton disabled={busy || videoLoading} onClick={() => void exportOne(active, true)}>アプリで送る</SecondaryButton>}
                      {slides.length > 1 && <SecondaryButton disabled={busy || videoLoading} onClick={() => void exportAll()}>全{slides.length}枚を書き出す（ZIP）</SecondaryButton>}
                    </div>
                  </Panel>

                  <Panel>
                    <PanelHeading title="背景" note={videoLoading ? "背景動画を読み込んでいます…" : video?.fileName ?? "画像ごとに、動画の好きなフレームを背景にできます。"} />
                    <input
                      ref={fileInput}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) void switchVideo(() => VideoFrameSource.openFile(file), "動画を読み込みました。");
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton disabled={busy || videoLoading} onClick={() => fileInput.current?.click()}>別の動画を選ぶ</SecondaryButton>
                      {video?.fileName && (
                        <SecondaryButton disabled={busy} onClick={() => void switchVideo(() => VideoFrameSource.openUrl(SAVED_TRACKS_VIDEO_URL), "標準の動画に戻しました。")}>標準の動画に戻す</SecondaryButton>
                      )}
                    </div>

                    {video && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
                          <span>フレーム</span>
                          <span className="tabular-nums">{timeLabel(activeTime)} / {timeLabel(video.duration)}</span>
                        </div>
                        <input
                          type="range"
                          aria-label="背景のフレーム"
                          min={0}
                          max={video.duration}
                          step={FRAME_STEP}
                          value={activeTime}
                          onChange={event => edit(active.track.id, { time: Number(event.target.value) })}
                          className="mt-1 w-full accent-violet-500"
                        />
                        <div className="mt-1 flex gap-2">
                          <SecondaryButton onClick={() => stepFrame(-1)} className="min-h-9 flex-1 px-3 text-xs">◀ 1コマ戻す</SecondaryButton>
                          <SecondaryButton onClick={() => stepFrame(1)} className="min-h-9 flex-1 px-3 text-xs">1コマ進める ▶</SecondaryButton>
                        </div>
                      </div>
                    )}

                    <div className="mt-4">
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>位置</span>
                      <input
                        type="range"
                        aria-label="背景の位置"
                        min={0}
                        max={1}
                        step={0.005}
                        value={activePan}
                        onChange={event => edit(active.track.id, { pan: Number(event.target.value) })}
                        className="mt-1 w-full accent-violet-500"
                      />
                    </div>
                  </Panel>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
