"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument, ItemMusic } from "@/lib/generator/model";
import {
  chosenMusicItem, EMPTY_MUSIC, musicEdited, musicPreference, parseClock, updateMusic, waveformLevels,
  type StartTimeHit, type VideoPreference,
} from "@/lib/generator/video";
import { parsePcm } from "@/lib/generator/pcm";
import { downloadAudio, type AudioEntry } from "./audio-files";
import { generatorJson } from "./generator-client";

export type { AudioEntry } from "./audio-files";

/**
 * 音声を読む。まずブラウザのデコーダーに任せ、読めなければ非圧縮WAV／AIFFとして自前で読む
 * （ChromeはAIFFを読めない。Safariとの差を埋める）。decodeAudioDataは渡したバイト列を手放すので複製して渡す。
 */
export async function decodeAudio(context: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  try {
    return await context.decodeAudioData(bytes.slice(0));
  } catch (error) {
    const pcm = parsePcm(bytes);
    if (!pcm || !pcm.channels[0]?.length) throw error;
    const buffer = new AudioBuffer({ length: pcm.channels[0].length, numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate });
    pcm.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
    return buffer;
  }
}

/**
 * 動画の音楽設定（2026-11-08〜 共有）。
 * - 曲・範囲・フェード：作品の content.music。掲載の上下：ページの musicItemId。どちらも画像と同じ下書き → 「保存」で確定。
 * - 音声ファイル：Backblaze B2。読み出した分は端末の IndexedDB にキャッシュする（audio-files.ts）。
 * このファイルは文書（下書きを含む）を読み、変更は編集画面（MusicHost）へ渡すだけ。下書きの持ち主は編集画面。
 */

const PEAK_BUCKETS = 240;

export type DecodedAudio = { buffer: AudioBuffer; peaks: number[] };

/** まだ共有へ送れていない音声（選んだ直後・送信の失敗・この端末の旧設定）。「保存」のときにも送り直す。 */
export type LocalAudio = {
  entry: AudioEntry;
  phase: "preparing" | "uploading" | "failed" | "waiting";
  progress: number;
  error: string | null;
};

/** 編集画面が持つ下書きへの書き口。 */
export type MusicHost = {
  /** この画像の編集ロックを持っているか。持っていなければ設定を変えられない（画像と同じ）。 */
  editable: boolean;
  localAudio: Record<string, LocalAudio>;
  setItemMusic(itemId: string, music: ItemMusic | null): void;
  setPageMusic(pageId: string, itemId: string): void;
  selectAudio(itemId: string, file: File): Promise<void>;
  retryUpload(itemId: string): void;
  removeAudio(itemId: string): void;
};

type SharedEntry = { state: "loading" } | { state: "ready"; entry: AudioEntry } | { state: "error"; error: string };

/** 共有の音声（audioId ごと）を、要るときだけ読む。同じ音声を何度も取りにいかない。 */
class SharedAudioStore {
  private value: Record<string, SharedEntry> = {};
  private promises = new Map<string, Promise<AudioEntry>>();
  private listeners = new Set<() => void>();

  constructor(readonly documentId: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get = () => this.value;
  private static readonly EMPTY: Record<string, SharedEntry> = {};
  getServer = () => SharedAudioStore.EMPTY;

  private set(audioId: string, entry: SharedEntry) {
    this.value = { ...this.value, [audioId]: entry };
    this.listeners.forEach(listener => listener());
  }

  load(audioId: string): Promise<AudioEntry> {
    let promise = this.promises.get(audioId);
    if (!promise) {
      this.set(audioId, { state: "loading" });
      promise = downloadAudio(this.documentId, audioId);
      this.promises.set(audioId, promise);
      promise.then(
        entry => this.set(audioId, { state: "ready", entry }),
        (error: Error) => { this.promises.delete(audioId); this.set(audioId, { state: "error", error: error.message }); },
      );
    }
    return promise;
  }

  /** アップロードした音声は、そのまま手元の分を使う（読み直さない）。 */
  prime(audioId: string, entry: AudioEntry) {
    this.promises.set(audioId, Promise.resolve(entry));
    this.set(audioId, { state: "ready", entry });
  }
}

type StartTimeQueryItem = { id: string; uid: string | null; no: string | null; title: string; artist: string };

/** Release Master の Start Time を、最初に購読されたときに1回だけ読む。 */
class StartTimeStore {
  private value: { hits: Record<string, StartTimeHit> | null; error: string | null } = { hits: null, error: null };
  private listeners = new Set<() => void>();
  private started = false;

  constructor(private readonly items: StartTimeQueryItem[]) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.start();
    return () => { this.listeners.delete(listener); };
  };

  get = () => this.value;

  private start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    if (!this.items.length) { this.value = { hits: {}, error: null }; return; }
    const chunks: StartTimeQueryItem[][] = [];
    for (let index = 0; index < this.items.length; index += 60) chunks.push(this.items.slice(index, index + 60));
    void Promise.all(chunks.map(chunk => fetch("/api/generator/start-times", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: chunk }),
    }).then(response => generatorJson<{ startTimes: Record<string, StartTimeHit> }>(response))))
      .then(results => { this.value = { hits: Object.assign({}, ...results.map(result => result.startTimes)), error: null }; })
      .catch(error => { this.value = { hits: {}, error: (error as Error).message }; })
      .finally(() => this.listeners.forEach(listener => listener()));
  }
}

export type MusicPageStatus = { itemId: string; ready: boolean; reason: string | null };

/** その作品の音声の状態。`entry` があれば試聴・書き出しに使える。 */
export type MusicAudio =
  | { kind: "none"; entry: null }
  | { kind: "local"; entry: AudioEntry; local: LocalAudio }
  | { kind: "loading"; entry: null; audioId: string }
  | { kind: "ready"; entry: AudioEntry; audioId: string }
  | { kind: "error"; entry: null; audioId: string; error: string };

export type MusicApi = {
  documentId: string;
  enabled: boolean;
  editable: boolean;
  startTimes: Record<string, StartTimeHit> | null;
  startTimesError: string | null;
  /** その作品の Start Time（秒）。空・読めないときは null。 */
  sheetStart(itemId: string): number | null;
  preference(itemId: string): VideoPreference;
  edited(itemId: string): boolean;
  update(itemId: string, next: Partial<VideoPreference>): void;
  reset(itemId: string): void;
  choice(page: CanvasPreviewPage): string;
  setChoice(pageId: string, itemId: string): void;
  audio(itemId: string): MusicAudio;
  /** 共有の音声を端末へ読み込む（まだなら）。画面に出したときに呼ぶ。 */
  fetchAudio(itemId: string): void;
  /** 音声を手元に用意する。書き出しの直前に使う。 */
  loadAudio(itemId: string): Promise<AudioEntry>;
  setAudio(itemId: string, file: File): Promise<void>;
  retryUpload(itemId: string): void;
  removeAudio(itemId: string): void;
  primeAudio(audioId: string, entry: AudioEntry): void;
  decode(itemId: string): Promise<DecodedAudio>;
  status(page: CanvasPreviewPage): MusicPageStatus | null;
  audioContext(): AudioContext;
};

export function videoPage(page: CanvasPreviewPage | null): boolean {
  return Boolean(page && (page.kind === "adopted" || page.kind === "listed"));
}

const NO_HOST: MusicHost = {
  editable: false,
  localAudio: {},
  setItemMusic: () => {},
  setPageMusic: () => {},
  selectAudio: async () => {},
  retryUpload: () => {},
  removeAudio: () => {},
};

/** `document` は下書きを当てた文書（プレビューと同じもの）。 */
export function useMusicStore(document: GeneratorDocument, host: MusicHost = NO_HOST): MusicApi {
  const documentId = document.id;
  const enabled = document.series !== "weekly";
  const shared = useMemo(() => new SharedAudioStore(documentId), [documentId]);
  const sharedState = useSyncExternalStore(shared.subscribe, shared.get, shared.getServer);

  // Start Time は文書の作品（採用・掲載）をまとめて1回だけ読む。
  const items = useMemo(() => {
    const onVideoPages = new Set(document.pages.filter(page => page.kind === "adopted" || page.kind === "listed").flatMap(page => page.itemIds));
    return document.items.filter(item => onVideoPages.has(item.id))
      .map(item => ({ id: item.id, uid: item.source.uid, no: item.source.no, title: item.content.fields.title, artist: item.content.fields.artist }));
  }, [document.items, document.pages]);
  const itemsKey = items.map(item => `${item.id}:${item.uid}:${item.no}`).join(",");
  // 作品の組が変わったときだけ読み直す
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startTimesStore = useMemo(() => new StartTimeStore(enabled ? items : []), [itemsKey, enabled]);
  const startTimes = useSyncExternalStore(startTimesStore.subscribe, startTimesStore.get, startTimesStore.get);

  const audioRef = useRef<AudioContext | null>(null);
  const decodedRef = useRef(new Map<string, { blob: Blob; promise: Promise<DecodedAudio> }>());
  useEffect(() => () => { void audioRef.current?.close(); audioRef.current = null; }, []);

  const musicOf = useMemo(() => {
    const map = new Map(document.items.map(item => [item.id, item.content.music ?? null]));
    return (itemId: string) => map.get(itemId) ?? null;
  }, [document.items]);
  const pageOf = useMemo(() => new Map(document.pages.map(page => [page.id, page])), [document.pages]);

  return useMemo<MusicApi>(() => {
    const audioContext = () => (audioRef.current ??= new AudioContext());
    const sheetStart = (itemId: string) => {
      const raw = startTimes.hits?.[itemId]?.startTime || "";
      return raw ? parseClock(raw) : null;
    };
    const preference = (itemId: string) => musicPreference(musicOf(itemId), sheetStart(itemId));
    const choice = (page: CanvasPreviewPage) => chosenMusicItem(page.slots.map(slot => slot.id), pageOf.get(page.id)?.musicItemId);
    const audio = (itemId: string): MusicAudio => {
      const local = host.localAudio[itemId];
      if (local) return { kind: "local", entry: local.entry, local };
      const audioId = musicOf(itemId)?.audioId;
      if (!audioId) return { kind: "none", entry: null };
      const value = sharedState[audioId];
      if (value?.state === "ready") return { kind: "ready", entry: value.entry, audioId };
      if (value?.state === "error") return { kind: "error", entry: null, audioId, error: value.error };
      return { kind: "loading", entry: null, audioId };
    };
    const loadAudio = (itemId: string): Promise<AudioEntry> => {
      const value = audio(itemId);
      if (value.entry) return Promise.resolve(value.entry);
      if (value.kind === "none") return Promise.reject(new Error("音声ファイルが未設定です。"));
      return shared.load(value.audioId);
    };
    return {
      documentId,
      enabled,
      editable: host.editable,
      startTimes: startTimes.hits,
      startTimesError: startTimes.error,
      sheetStart,
      preference,
      edited: itemId => musicEdited(musicOf(itemId)),
      update(itemId, next) {
        if (!host.editable) return;
        host.setItemMusic(itemId, updateMusic(musicOf(itemId), next, sheetStart(itemId)));
      },
      reset(itemId) {
        if (!host.editable) return;
        const current = musicOf(itemId);
        host.setItemMusic(itemId, { ...EMPTY_MUSIC, audioId: current?.audioId ?? null });
      },
      choice,
      setChoice: (pageId, itemId) => { if (host.editable) host.setPageMusic(pageId, itemId); },
      audio,
      fetchAudio(itemId) {
        const value = audio(itemId);
        if (value.kind === "loading" && !sharedState[value.audioId]) void shared.load(value.audioId).catch(() => undefined);
      },
      loadAudio,
      setAudio: (itemId, file) => host.selectAudio(itemId, file),
      retryUpload: itemId => host.retryUpload(itemId),
      removeAudio(itemId) { decodedRef.current.delete(itemId); host.removeAudio(itemId); },
      primeAudio: (audioId, entry) => shared.prime(audioId, entry),
      decode(itemId) {
        return loadAudio(itemId).then(entry => {
          const cached = decodedRef.current.get(itemId);
          if (cached && cached.blob === entry.blob) return cached.promise;
          const promise = entry.blob.arrayBuffer().then(bytes => decodeAudio(audioContext(), bytes)).then(buffer => {
            const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
            return { buffer, peaks: waveformLevels(channels, PEAK_BUCKETS) };
          });
          promise.catch(() => decodedRef.current.delete(itemId));
          decodedRef.current.set(itemId, { blob: entry.blob, promise });
          return promise;
        });
      },
      status(page) {
        if (!enabled || !videoPage(page)) return null;
        const itemId = choice(page), value = audio(itemId);
        if (value.kind === "none") return { itemId, ready: false, reason: "音声ファイルが未設定です" };
        if (value.kind === "error") return { itemId, ready: false, reason: value.error };
        // 共有の音声で、まだ端末に無いもの（loading）も書き出しの直前に読めるので「用意できる」とみなす。
        return { itemId, ready: true, reason: null };
      },
      audioContext,
    };
  }, [documentId, enabled, host, musicOf, pageOf, sharedState, shared, startTimes]);
}

const MusicContext = createContext<MusicApi | null>(null);
export const MusicProvider = MusicContext.Provider;

export function useMusic(): MusicApi | null {
  return useContext(MusicContext);
}
