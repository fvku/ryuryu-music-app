/**
 * Release Master のリスナー列（「リスナー / Google Script 作動」）へ、
 * アーティストの Spotify 月間リスナー数を書き込む。
 *
 * 以前は Google Apps Script（fetchMonthlyListeners）で行っていた処理の移植。
 * 違いは2点:
 *   - アーティストの特定。GAS はアーティスト名で検索した1件目を使っていたため、
 *     同名の別人を拾うことがあった。ここでは Spotify URL があればアルバムの
 *     クレジットからアーティストIDを引く。URL が無い行（配信前）だけ名前で検索し、
 *     名前が完全一致する候補が1人だけのときに採用する。
 *   - 失敗時の扱い。GAS は "Artist not found" 等をセルに書いていたが、
 *     ここでは書かずに結果として返す（セルが空のままなら次回また試す）。
 *
 * 月間リスナー数は公式APIに無いので、アーティストページのHTMLから読む
 * （data-testid="monthly-listeners-label" に "47,117,089 monthly listeners" の形で入っている）。
 */

import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";
import { getAccessToken } from "@/lib/spotify";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { parseAlbumId } from "@/lib/playlist-sources";
import { isInSheetDateRange, type SheetDateRange } from "@/lib/weekly/week";

/**
 * アーティストページはUAによって返るHTMLが違う。新しいブラウザのUAだと
 * クライアント描画用の空のページが返り、リスナー数が入っていない（2026-09-28に実測）。
 * GAS と同じ短いUAにするとサーバー描画済みのページが返る
 */
const PAGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const VARIOUS_ARTISTS_ID = "0LyfQWJT6nXafLPZqxe9Of";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 0; i < attempts && res.status === 429; i++) {
    const header = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(header) && header > 0 ? header : 2 ** i;
    await sleep(Math.min(wait, 15) * 1000);
    res = await fetch(url, init);
  }
  return res;
}

/** Spotify のアルバムIDだけを取り出す（Bandcamp の /album/xxx 等は1件混ざるとAPIが400になる） */
function spotifyAlbumId(url: string): string | null {
  if (!url.includes("spotify")) return null;
  const id = parseAlbumId(url);
  return id && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
}

function normName(s: string) {
  return (s ?? "").normalize("NFKC").trim().toLowerCase();
}

/**
 * リスナー列の位置。見出しは「リスナー」と「リスナー（改行）Google Script 作動」の2列があり、
 * GAS が書いていたのは後者。後者が無ければ前者に書く。
 */
export function findListenerColumn(headerRow: string[]): number | undefined {
  const scripted = headerRow.findIndex((h) => /google\s*script/i.test(h ?? ""));
  if (scripted >= 0) return scripted;
  const plain = headerRow.findIndex((h) => (h ?? "").trim().startsWith("リスナー"));
  return plain >= 0 ? plain : undefined;
}

/** アーティストページの HTML から月間リスナー数を読む。読めなければ null */
export function parseMonthlyListeners(html: string): number | null {
  const labeled = html.match(/monthly-listeners-label"[^>]*>\s*([\d,]+)\s+monthly listeners/i);
  const plain = labeled ?? html.match(/>\s*([\d,]+)\s+monthly listeners/i);
  if (!plain) return null;
  const value = Number(plain[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

async function fetchMonthlyListeners(artistId: string): Promise<number | null> {
  const res = await fetchWithRetry(`https://open.spotify.com/artist/${artistId}`, {
    headers: { "User-Agent": PAGE_UA, "Accept-Language": "en-US,en;q=0.9" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`アーティストページの取得に失敗しました (${res.status})`);
  return parseMonthlyListeners(await res.text());
}

/** アルバムIDから先頭のアーティストIDを引く（20件ずつ） */
async function resolveAlbumArtists(albumIds: string[], token: string): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < albumIds.length; i += 20) {
    const chunk = albumIds.slice(i, i + 20);
    const res = await fetchWithRetry(`https://api.spotify.com/v1/albums?ids=${chunk.join(",")}&market=JP`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      for (const album of data.albums ?? []) {
        const artist = (album?.artists ?? []).find((a: { id?: string }) => a?.id && a.id !== VARIOUS_ARTISTS_ID);
        if (album?.id && artist) out.set(album.id, { id: artist.id, name: artist.name ?? "" });
      }
    }
    if (i + 20 < albumIds.length) await sleep(150);
  }
  return out;
}

/** 名前が完全一致するアーティストが1人だけならそのIDを返す */
async function searchArtistExact(name: string, token: string): Promise<{ id: string } | { ambiguous: number } | null> {
  const params = new URLSearchParams({ q: name, type: "artist", limit: "10", market: "JP" });
  const res = await fetchWithRetry(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`アーティスト検索に失敗しました (${res.status})`);
  const data = await res.json();
  const exact = (data.artists?.items ?? []).filter(
    (a: { id?: string; name?: string } | null) => a?.id && normName(a.name ?? "") === normName(name)
  );
  if (exact.length === 1) return { id: exact[0].id };
  if (exact.length > 1) return { ambiguous: exact.length };
  return null;
}

export interface FillListenersDetail {
  row: number;
  title: string;
  artist: string;
  /** 書き込んだ値。書けなかった行は null */
  listeners: number | null;
  /** 書けなかった理由、またはアーティストの特定方法 */
  note: string;
}

export interface FillListenersOptions {
  apply: boolean;
  dateRange: SheetDateRange;
  /** 数値が入っている行も取り直す */
  force?: boolean;
  log?: (msg: string) => void;
}

export interface FillListenersResult {
  total: number;
  written: number;
  /** 既に数値が入っていて対象外にした行 */
  alreadyFilled: number;
  details: FillListenersDetail[];
}

export async function fillListeners(options: FillListenersOptions): Promise<FillListenersResult> {
  const { apply, dateRange, force = false, log = () => {} } = options;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const [headerRow = [], ...dataRows] = resp.data.values ?? [];
  const col = buildHeaderMap(headerRow);

  const listenerIdx = findListenerColumn(headerRow);
  if (listenerIdx === undefined) throw new Error("「リスナー」列が見つかりません");
  const titleIdx = col["Title"] ?? 2;
  const artistIdx = col["Artist"] ?? 3;
  const dateIdx = col["Date"] ?? 1;
  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL];

  const inRange = dataRows
    .map((row, i) => ({
      rowNum: i + 2,
      title: (row[titleIdx] ?? "").trim(),
      artist: (row[artistIdx] ?? "").trim(),
      current: (row[listenerIdx] ?? "").toString().replace(/,/g, "").trim(),
      albumId: spotifyAlbumId(spotifyIdx !== undefined ? row[spotifyIdx] ?? "" : ""),
      date: row[dateIdx] ?? "",
    }))
    .filter((r) => r.artist && isInSheetDateRange(r.date, dateRange));

  const hasNumber = (v: string) => v !== "" && !Number.isNaN(Number(v));
  const targets = inRange.filter((r) => force || !hasNumber(r.current));
  const result: FillListenersResult = {
    total: targets.length, written: 0, alreadyFilled: inRange.length - targets.length, details: [],
  };
  if (targets.length === 0) return result;

  const token = await getAccessToken();
  const albumIds = [...new Set(targets.map((t) => t.albumId).filter((id): id is string => !!id))];
  log(`アルバム ${albumIds.length}枚のアーティストを取得中...`);
  const albumArtists = await resolveAlbumArtists(albumIds, token);

  // 行ごとにアーティストIDを決める（同じアーティストは1回だけページを読む）
  const artistOf = new Map<number, { id: string; via: string }>();
  const searched = new Map<string, Awaited<ReturnType<typeof searchArtistExact>>>();
  for (const t of targets) {
    const fromAlbum = t.albumId ? albumArtists.get(t.albumId) : undefined;
    if (fromAlbum) { artistOf.set(t.rowNum, { id: fromAlbum.id, via: "アルバムから特定" }); continue; }

    const key = normName(t.artist);
    if (!searched.has(key)) {
      try {
        searched.set(key, await searchArtistExact(t.artist, token));
      } catch (e) {
        searched.set(key, null);
        log(`[行${t.rowNum}] ${t.artist}: ${e}`);
      }
      await sleep(200);
    }
    const hit = searched.get(key);
    if (hit && "id" in hit) {
      artistOf.set(t.rowNum, { id: hit.id, via: "名前で特定" });
    } else {
      result.details.push({
        row: t.rowNum, title: t.title, artist: t.artist, listeners: null,
        note: hit && "ambiguous" in hit
          ? `同名のアーティストが${hit.ambiguous}人います。Spotify URLが入ってから再実行してください`
          : "名前が一致するアーティストが見つかりません。Spotify URLが入ってから再実行してください",
      });
    }
  }

  const listenersById = new Map<string, number | null | Error>();
  const ids = [...new Set([...artistOf.values()].map((a) => a.id))];
  log(`アーティスト ${ids.length}人の月間リスナー数を取得中...`);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        listenersById.set(id, await fetchMonthlyListeners(id));
      } catch (e) {
        listenersById.set(id, e instanceof Error ? e : new Error(String(e)));
      }
      await sleep(250);
    }
  }));

  const cListener = indexToColumnLetter(listenerIdx);
  const writes: { range: string; values: number[][] }[] = [];
  for (const t of targets) {
    const artist = artistOf.get(t.rowNum);
    if (!artist) continue;
    const value = listenersById.get(artist.id);
    if (typeof value === "number") {
      writes.push({ range: `'Release Master'!${cListener}${t.rowNum}`, values: [[value]] });
      result.details.push({ row: t.rowNum, title: t.title, artist: t.artist, listeners: value, note: artist.via });
    } else {
      result.details.push({
        row: t.rowNum, title: t.title, artist: t.artist, listeners: null,
        note: value instanceof Error ? value.message : "ページから月間リスナー数を読み取れませんでした",
      });
    }
  }

  if (apply && writes.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: writes },
    });
  }
  result.written = apply ? writes.length : 0;
  result.details.sort((a, b) => a.row - b.row);
  return result;
}
