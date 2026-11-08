"use client";

import { parseVideoPreference, videoChoiceKey, videoPreferenceKey, type VideoPreference } from "@/lib/generator/video";
import { generatorJson, type GeneratorApiError } from "./generator-client";
import { encodeAacForStorage, mp4AudioCodec } from "./video-export";

/**
 * 動画用の音声ファイルの出し入れ（ブラウザ側）。
 *
 * - 共有：選んだ時点で Backblaze B2 へアップロードする（サーバーが出す署名付きURLへ直接送る。Vercelの4.5MB上限を通さない）。
 *   MP3・AACの m4a はそのまま、WAV・AIF などは AAC 256kbps に変換してから送る（計画書 §3-1）。
 * - キャッシュ：読み出した音声は IndexedDB に audioId ごとに置く（音声IDの中身は変わらないので、期限は設けない）。
 * - 2026-11-08 より前は、設定を localStorage、音声を IndexedDB（文書ID:作品ID）に端末の中だけで持っていた。
 *   これを「この端末の既存設定」として読み出し、共有側が空なら未保存の下書きとして出す。保存か破棄で消す。
 */

const DB_NAME = "ryuryu_generator_audio";
const STORE = "files";
const CACHE_PREFIX = "audio:";
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

export type AudioEntry = { name: string; type: string; blob: Blob };

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

export async function readCachedAudio(audioId: string): Promise<AudioEntry | null> {
  try {
    const entry = await withStore<AudioEntry>("readonly", store => store.get(`${CACHE_PREFIX}${audioId}`));
    return entry?.blob ? entry : null;
  } catch { return null; }
}

export async function writeCachedAudio(audioId: string, entry: AudioEntry): Promise<void> {
  // 書けなくても（容量不足・プライベートブラウズ）、この画面を開いている間はメモリの分で使える。
  await withStore("readwrite", store => { store.put(entry, `${CACHE_PREFIX}${audioId}`); }).catch(() => undefined);
}

/** 2026-11-08 より前に、この端末だけに保存していた設定。 */
export type LegacyMusic = {
  audio: Record<string, AudioEntry>;
  preferences: Record<string, VideoPreference>;
  choices: Record<string, string>;
};

export async function readLegacyMusic(documentId: string): Promise<LegacyMusic> {
  const choices: Record<string, string> = {}, preferences: Record<string, VideoPreference> = {};
  const choicePrefix = videoChoiceKey(documentId, ""), preferencePrefix = videoPreferenceKey(documentId, "");
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
  } catch { /* 読めなければ無いものとして扱う */ }
  const audio: Record<string, AudioEntry> = {};
  const prefix = `${documentId}:`;
  try {
    const keys = await withStore<IDBValidKey[]>("readonly", store => store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)));
    for (const key of keys || []) {
      const entry = await withStore<AudioEntry>("readonly", store => store.get(key));
      if (entry?.blob) audio[String(key).slice(prefix.length)] = entry;
    }
  } catch { /* 同上 */ }
  return { audio, preferences, choices };
}

/** 共有へ移した（保存した）、または破棄した分の、この端末だけの旧設定を消す。 */
export async function forgetLegacyMusic(documentId: string, { itemIds = [], pageIds = [] }: { itemIds?: string[]; pageIds?: string[] }) {
  try {
    for (const id of itemIds) window.localStorage.removeItem(videoPreferenceKey(documentId, id));
    for (const id of pageIds) window.localStorage.removeItem(videoChoiceKey(documentId, id));
  } catch { /* 消せなくても、次に開いたとき未保存として出るだけ */ }
  if (!itemIds.length) return;
  await withStore("readwrite", store => { for (const id of itemIds) store.delete(`${documentId}:${id}`); }).catch(() => undefined);
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

/** 先頭のバイトから形式を見分ける（拡張子やブラウザの MIME は当てにしない）。 */
export function sniffAudio(head: Uint8Array): "audio/mpeg" | "audio/mp4" | null {
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return "audio/mpeg";
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (head.length >= 8 && String.fromCharCode(...head.slice(4, 8)) === "ftyp") return "audio/mp4";
  return null;
}

function renamed(name: string, extension: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "audio";
  return `${base}.${extension}`;
}

/**
 * アップロードする形にする。MP3 と AAC の m4a はそのまま（非可逆の圧縮を重ねないため）、
 * それ以外（WAV・AIF・ALAC など）は AAC 256kbps の m4a に変換する。
 * Apple Music でダウンロードした曲（コピー防止つき）などは読めないので、ここで理由を返す。
 */
export async function prepareUpload(entry: AudioEntry, decodable: (blob: Blob) => Promise<void>): Promise<AudioEntry> {
  const head = new Uint8Array(await entry.blob.slice(0, 16).arrayBuffer());
  const sniffed = sniffAudio(head);
  const unreadable = new Error("この音声ファイルを読み込めませんでした。mp3・m4a・wav・aif のどれかで選び直してください（Apple Musicでダウンロードした曲はコピー防止のため読み込めません）。");
  let result: AudioEntry;
  if (sniffed === "audio/mpeg" || (sniffed === "audio/mp4" && (await mp4AudioCodec(entry.blob)) === "aac")) {
    await decodable(entry.blob).catch(() => { throw unreadable; });
    result = { name: entry.name, type: sniffed, blob: entry.blob.type === sniffed ? entry.blob : new Blob([entry.blob], { type: sniffed }) };
  } else {
    let converted: Blob;
    try {
      converted = await encodeAacForStorage(entry.blob);
    } catch (error) {
      throw /このブラウザ/.test((error as Error).message) ? error : unreadable;
    }
    result = { name: renamed(entry.name, "m4a"), type: "audio/mp4", blob: converted };
  }
  if (result.blob.size > AUDIO_MAX_BYTES) throw new Error(`音声ファイルが大きすぎます（${Math.ceil(result.blob.size / 1024 / 1024)}MB）。50MB以下にしてください。`);
  return result;
}

type LockPayload = { kind: "item"; targetId: string; clientId: string; token: string; generation: number };

/** 署名付きURLへ直接送る。fetch では送信の進み具合が取れないので XMLHttpRequest を使う。 */
function putWithProgress(url: string, blob: Blob, headers: Record<string, string>, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) request.setRequestHeader(key, value);
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`音声を送れませんでした（${request.status}）。`)));
    request.onerror = () => reject(new Error("音声を送れませんでした。通信を確かめてください。"));
    request.onabort = () => reject(new Error("音声の送信を中止しました。"));
    request.send(blob);
  });
}

/**
 * 1ファイルを共有へ送る。準備（サーバーが作品のロックを確かめて署名付きURLを出す）→ B2へ直接送る →
 * 確定（サーバーがサイズ・SHA-256を確かめて ready）。返した audioId を作品の content.music に入れて「保存」すると確定する。
 */
export async function uploadAudio({ documentId, itemId, lock, entry, onProgress }: {
  documentId: string;
  itemId: string;
  lock: LockPayload;
  entry: AudioEntry;
  onProgress(ratio: number): void;
}): Promise<string> {
  const audioId = crypto.randomUUID(), sha256 = await sha256Hex(entry.blob);
  const endpoint = `/api/generator/documents/${documentId}/audio`;
  const post = (body: Record<string, unknown>) => fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, audioId, ...lock }),
  }).then(response => generatorJson<Record<string, unknown>>(response));
  const prepared = await post({ action: "prepare", itemId, mimeType: entry.type, bytes: entry.blob.size, sha256, name: entry.name }) as
    { status: string; uploadUrl?: string; headers?: Record<string, string> };
  if (prepared.status !== "ready") {
    if (!prepared.uploadUrl) throw new Error("音声の送り先を受け取れませんでした。");
    await putWithProgress(prepared.uploadUrl, entry.blob, prepared.headers || {}, onProgress);
  }
  onProgress(1);
  await post({ action: "complete" });
  await writeCachedAudio(audioId, entry);
  return audioId;
}

/** 共有の音声を読む。端末のキャッシュに無ければ、サーバーが出す署名付きURLから取得して確かめてから置く。 */
export async function downloadAudio(documentId: string, audioId: string): Promise<AudioEntry> {
  const cached = await readCachedAudio(audioId);
  if (cached) return cached;
  let info: { name: string; mimeType: string; bytes: number; sha256: string; url: string };
  try {
    info = await generatorJson(await fetch(`/api/generator/documents/${documentId}/audio/${audioId}`, { cache: "no-store" }));
  } catch (error) {
    const value = error as GeneratorApiError;
    throw new Error(value.message || "音声を読み込めませんでした。");
  }
  let blob: Blob;
  try {
    const response = await fetch(info.url, { cache: "no-store" });
    if (!response.ok) throw new Error();
    blob = await response.blob();
  } catch {
    throw new Error("音声をダウンロードできませんでした。通信を確かめて、もう一度試してください。");
  }
  if (blob.size !== info.bytes || (await sha256Hex(blob)) !== info.sha256) throw new Error("ダウンロードした音声が壊れていました。もう一度試してください。");
  const entry: AudioEntry = { name: info.name, type: info.mimeType, blob: new Blob([blob], { type: info.mimeType }) };
  await writeCachedAudio(audioId, entry);
  return entry;
}
