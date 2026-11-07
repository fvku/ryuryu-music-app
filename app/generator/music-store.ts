"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import type { GeneratorDocument } from "@/lib/generator/model";
import {
  parseClock, parseVideoPreference, videoChoiceKey, videoPreferenceKey, waveformLevels,
  VIDEO_DEFAULT_SECONDS, type StartTimeHit, type VideoPreference,
} from "@/lib/generator/video";
import { parsePcm } from "@/lib/generator/pcm";
import { generatorJson } from "./generator-client";

/**
 * 音声を読む。まずブラウザのデコーダーに任せ、読めなければ非圧縮WAV／AIFFとして自前で読む
 * （ChromeはAIFFを読めない。Safariとの差を埋める）。decodeAudioDataは渡したバイト列を手放すので複製して渡す。
 */
async function decodeAudio(context: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
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
 * 動画の音楽設定。すべてこのブラウザの中だけに置き、共有DBにもRelease Masterにも書かない。
 * - 曲の選択（掲載の上下）と範囲・フェード：localStorage
 * - 音声ファイル：IndexedDB（再読み込みしても残す。アップロードはしない）
 */

const PEAK_BUCKETS = 240;
const DB_NAME = "ryuryu_generator_audio";
const STORE = "files";

export type AudioEntry = { name: string; type: string; blob: Blob };
export type DecodedAudio = { buffer: AudioBuffer; peaks: number[] };
type State = {
  choices: Record<string, string>;
  preferences: Record<string, VideoPreference>;
  audio: Record<string, AudioEntry>;
  audioReady: boolean;
};

const EMPTY: State = { choices: {}, preferences: {}, audio: {}, audioReady: false };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode), request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

class MusicStore {
  private state: State = EMPTY;
  private listeners = new Set<() => void>();
  private started = false;

  constructor(readonly documentId: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.start();
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.state;
  getServerSnapshot = () => EMPTY;

  private set(next: Partial<State>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }

  private start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    const choices: Record<string, string> = {}, preferences: Record<string, VideoPreference> = {};
    const choicePrefix = videoChoiceKey(this.documentId, ""), preferencePrefix = videoPreferenceKey(this.documentId, "");
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key) continue;
        if (key.startsWith(choicePrefix)) choices[key.slice(choicePrefix.length)] = window.localStorage.getItem(key) || "";
        else if (key.startsWith(preferencePrefix)) {
          const value = parseVideoPreference(window.localStorage.getItem(key));
          if (value) preferences[key.slice(preferencePrefix.length)] = value;
        }
      }
    } catch { /* 読めなければ初期値で始める */ }
    this.set({ choices, preferences });
    const prefix = `${this.documentId}:`;
    void withStore<IDBValidKey[]>("readonly", store => store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)))
      .then(async keys => {
        const audio: Record<string, AudioEntry> = {};
        for (const key of keys || []) {
          const entry = await withStore<AudioEntry>("readonly", store => store.get(key));
          if (entry?.blob) audio[String(key).slice(prefix.length)] = entry;
        }
        this.set({ audio, audioReady: true });
      })
      .catch(() => this.set({ audioReady: true }));
  }

  setChoice(pageId: string, itemId: string) {
    try { window.localStorage.setItem(videoChoiceKey(this.documentId, pageId), itemId); } catch { /* 覚えられなくても今の画面では使える */ }
    this.set({ choices: { ...this.state.choices, [pageId]: itemId } });
  }

  setPreference(itemId: string, value: VideoPreference | null) {
    const key = videoPreferenceKey(this.documentId, itemId), preferences = { ...this.state.preferences };
    try {
      if (value) window.localStorage.setItem(key, JSON.stringify(value));
      else window.localStorage.removeItem(key);
    } catch { /* 同上 */ }
    if (value) preferences[itemId] = value; else delete preferences[itemId];
    this.set({ preferences });
  }

  async setAudio(itemId: string, file: File) {
    const entry: AudioEntry = { name: file.name, type: file.type, blob: file };
    // 保存に失敗しても、この画面を開いている間は使えるようにする。
    await withStore("readwrite", store => { store.put(entry, `${this.documentId}:${itemId}`); }).catch(() => undefined);
    this.set({ audio: { ...this.state.audio, [itemId]: entry } });
  }

  async removeAudio(itemId: string) {
    await withStore("readwrite", store => { store.delete(`${this.documentId}:${itemId}`); }).catch(() => undefined);
    const audio = { ...this.state.audio };
    delete audio[itemId];
    this.set({ audio });
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

/** 試聴中の音。どの作品を、どこから鳴らしているか。 */
export type Playback = { itemId: string; from: number; startedAt: number; until: number | null };

export type MusicPageStatus = { itemId: string; ready: boolean; reason: string | null };

export type MusicApi = {
  documentId: string;
  enabled: boolean;
  state: State;
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
  setAudio(itemId: string, file: File): Promise<void>;
  removeAudio(itemId: string): Promise<void>;
  decode(itemId: string): Promise<DecodedAudio>;
  status(page: CanvasPreviewPage): MusicPageStatus | null;
  audioContext(): AudioContext;
};

export function videoPage(page: CanvasPreviewPage | null): boolean {
  return Boolean(page && (page.kind === "adopted" || page.kind === "listed"));
}

export function useMusicStore(document: GeneratorDocument): MusicApi {
  const documentId = document.id;
  const store = useMemo(() => new MusicStore(documentId), [documentId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const enabled = document.series !== "weekly";

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

  return useMemo<MusicApi>(() => {
    const audioContext = () => (audioRef.current ??= new AudioContext());
    const sheetStart = (itemId: string) => {
      const raw = startTimes.hits?.[itemId]?.startTime || "";
      return raw ? parseClock(raw) : null;
    };
    const defaults = (itemId: string): VideoPreference => ({ start: sheetStart(itemId) ?? 0, length: VIDEO_DEFAULT_SECONDS, fadeIn: false, fadeOut: false });
    const preference = (itemId: string) => state.preferences[itemId] ?? defaults(itemId);
    const choice = (page: CanvasPreviewPage) => {
      const saved = state.choices[page.id];
      return page.slots.some(slot => slot.id === saved) ? saved : page.slots[0]?.id ?? "";
    };
    return {
      documentId,
      enabled,
      state,
      startTimes: startTimes.hits,
      startTimesError: startTimes.error,
      sheetStart,
      preference,
      edited: itemId => Boolean(state.preferences[itemId]),
      update(itemId, next) {
        const value = { ...preference(itemId), ...next }, base = defaults(itemId);
        const isDefault = value.start === base.start && value.length === base.length && !value.fadeIn && !value.fadeOut;
        store.setPreference(itemId, isDefault ? null : value);
      },
      reset: itemId => store.setPreference(itemId, null),
      choice,
      setChoice: (pageId, itemId) => store.setChoice(pageId, itemId),
      setAudio: (itemId, file) => store.setAudio(itemId, file),
      removeAudio: itemId => { decodedRef.current.delete(itemId); return store.removeAudio(itemId); },
      decode(itemId) {
        const entry = state.audio[itemId];
        if (!entry) return Promise.reject(new Error("音声ファイルがありません。"));
        const cached = decodedRef.current.get(itemId);
        if (cached && cached.blob === entry.blob) return cached.promise;
        const promise = entry.blob.arrayBuffer().then(bytes => decodeAudio(audioContext(), bytes)).then(buffer => {
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
          return { buffer, peaks: waveformLevels(channels, PEAK_BUCKETS) };
        });
        promise.catch(() => decodedRef.current.delete(itemId));
        decodedRef.current.set(itemId, { blob: entry.blob, promise });
        return promise;
      },
      status(page) {
        if (!enabled || !videoPage(page)) return null;
        const itemId = choice(page);
        if (!state.audioReady) return { itemId, ready: false, reason: "音楽の設定を読み込んでいます…" };
        if (!state.audio[itemId]) return { itemId, ready: false, reason: "音声ファイルが未設定です" };
        return { itemId, ready: true, reason: null };
      },
      audioContext,
    };
  }, [documentId, enabled, state, startTimes, store]);
}

const MusicContext = createContext<MusicApi | null>(null);
export const MusicProvider = MusicContext.Provider;

export function useMusic(): MusicApi | null {
  return useContext(MusicContext);
}
