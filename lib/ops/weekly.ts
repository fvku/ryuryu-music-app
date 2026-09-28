/**
 * 週次リリース作業（/weekly）のコアロジック。
 *
 *   - 今週の行の状況（Spotify URL・Time・リスナー・収録タグ・WEEK）の読み出し
 *   - 洋楽（AOTYの貼り付け）・邦楽（New Music Wednesday）の候補と Release Master の突き合わせ
 *   - 候補の一括追加
 *
 * 「今週」は土曜〜金曜（lib/weekly/week.ts）。
 */

import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";
import { getAccessToken } from "@/lib/spotify";
import { buildHeaderMap, getCol, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { generateAlbumUid } from "@/lib/uid";
import { formatTimeTracks } from "@/lib/time-format";
import { parseAlbumId, parsePlaylistId } from "@/lib/playlist-sources";
import { fetchEmbedPlaylist } from "@/lib/ops/sync-playlist-tags";
import { findListenerColumn } from "@/lib/ops/fill-listeners";
import { excludeReasonFor, type AotyEntry } from "@/lib/weekly/aoty-parse";
import { isInWeek, normalizeSheetDate, toSheetDate, type WeekWindow } from "@/lib/weekly/week";

const SHEET = "'Release Master'";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** 重複判定のキー。[EP] 等の接頭辞・大文字小文字・全角半角の差を無視する */
export function releaseKey(title: string, artist: string): string {
  const norm = (s: string) => (s ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const bareTitle = (title ?? "").replace(/^\[(EP|Single|Album|Compilation)[\]}]\s*/i, "");
  return `${norm(bareTitle)}::${norm(artist)}`;
}

async function readSheet() {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET}!A1:AZ` });
  const [headerRow = [], ...dataRows] = (resp.data.values ?? []) as string[][];
  return { sheets, spreadsheetId, headerRow, dataRows, col: buildHeaderMap(headerRow) };
}

// ── 今週の状況 ──

export interface WeekRow {
  rowNum: number;
  date: string;
  title: string;
  artist: string;
  waboku: string;
  time: string;
  spotifyUrl: string;
  listeners: string;
  playlists: string;
  week: string;
  /** No.列が空だとアプリ・ジェネレーターに表示されない */
  hasNo: boolean;
}

export async function readWeekRows(window: WeekWindow): Promise<WeekRow[]> {
  const { headerRow, dataRows, col } = await readSheet();
  const listenerIdx = findListenerColumn(headerRow);
  const at = (row: string[], idx: number | undefined) => (idx === undefined ? "" : (row[idx] ?? "").toString().trim());

  return dataRows
    .map((row, i) => ({ row, rowNum: i + 2 }))
    .filter(({ row }) => at(row, getCol(col, "TITLE")) && isInWeek(at(row, getCol(col, "DATE")), window))
    .map(({ row, rowNum }) => ({
      rowNum,
      date: normalizeSheetDate(at(row, getCol(col, "DATE"))),
      title: at(row, getCol(col, "TITLE")),
      artist: at(row, getCol(col, "ARTIST")),
      waboku: at(row, getCol(col, "GENRE")),
      time: at(row, getCol(col, "TIME")),
      spotifyUrl: at(row, col[SHEET_COL.SPOTIFY_URL]),
      listeners: at(row, listenerIdx),
      playlists: at(row, col[SHEET_COL.PLAYLIST]),
      week: at(row, col[SHEET_COL.WEEK_ADOPTION]),
      hasNo: !!at(row, getCol(col, "NO")),
    }));
}

/** Release Master を指定行へスクロールした状態で開くURL */
export async function releaseMasterUrl(rowNum?: number): Promise<string> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");
  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
  const gid = meta.data.sheets?.find((s) => s.properties?.title === "Release Master")?.properties?.sheetId ?? 0;
  const range = rowNum ? `&range=A${rowNum}` : "";
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}${range}`;
}

/** Release Master 全体の「作品キー」と「Spotify アルバムID」。重複追加を防ぐ */
async function readExistingKeys() {
  const { dataRows, col } = await readSheet();
  const keys = new Map<string, number>();
  const albumIds = new Map<string, number>();
  const artists = new Map<string, { date: string; rowNum: number }[]>();
  dataRows.forEach((row, i) => {
    const title = (row[getCol(col, "TITLE")] ?? "").trim();
    const artist = (row[getCol(col, "ARTIST")] ?? "").trim();
    if (title && artist) keys.set(releaseKey(title, artist), i + 2);
    const date = normalizeSheetDate(row[getCol(col, "DATE")] ?? "");
    if (artist && date) {
      const key = normArtistName(artist);
      artists.set(key, [...(artists.get(key) ?? []), { date, rowNum: i + 2 }]);
    }
    const albumId = parseAlbumId(row[col[SHEET_COL.SPOTIFY_URL] ?? -1] ?? "");
    if (albumId) albumIds.set(albumId, i + 2);
  });
  return { keys, albumIds, artists };
}

function normArtistName(s: string) {
  return (s ?? "").normalize("NFKC").trim().toLowerCase();
}

/**
 * 同じアーティストの行が前後7日以内にあれば、その行番号を返す。
 * 邦楽は作品名がローマ字表記と日本語表記で揺れる（"ao wo komete" と「青を込めて」）ため、
 * 作品名の照合だけでは重複を見落とす
 */
function sameArtistNearby(
  artists: Map<string, { date: string; rowNum: number }[]>,
  names: string[],
  isoDate: string,
): number | null {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  for (const name of [names.join(", "), ...names]) {
    for (const hit of artists.get(normArtistName(name)) ?? []) {
      const diff = Math.abs(Date.parse(`${hit.date.replace(/\//g, "-")}T00:00:00Z`) - target);
      if (diff <= 7 * 24 * 60 * 60 * 1000) return hit.rowNum;
    }
  }
  return null;
}

// ── 候補 ──

export interface Candidate {
  /** 画面上の識別子 */
  id: string;
  source: "aoty" | "spotify";
  /** "YYYY-MM-DD" */
  date: string;
  /** シートに書く作品名（邦楽EPは "[EP] " 付き） */
  title: string;
  artist: string;
  waboku: "洋楽" | "邦楽";
  /** 表示用の種別（LP / EP / Mixtape / アルバム / シングル ...） */
  type: string;
  /** 対象外と判断した理由（初期状態でチェックを外す）。null なら追加候補 */
  excludeReason: string | null;
  /** 既に Release Master にある行番号 */
  existingRow: number | null;
  inWeek: boolean;
  // Spotify 由来の候補だけが持つ
  spotifyUrl?: string;
  coverUrl?: string;
  trackCount?: number;
  totalDurationMs?: number;
}

/** 洋楽：AOTY の解析結果を Release Master と突き合わせる */
export async function westernCandidates(entries: AotyEntry[], window: WeekWindow): Promise<Candidate[]> {
  const { keys } = await readExistingKeys();
  return entries.map((e, i) => ({
    id: `aoty-${i}`,
    source: "aoty",
    date: e.date,
    title: e.title,
    artist: e.artist,
    waboku: "洋楽",
    type: e.type,
    excludeReason: e.excludeReason,
    existingRow: keys.get(releaseKey(e.title, e.artist)) ?? null,
    inWeek: isInWeek(toSheetDate(e.date), window),
  }));
}

interface SpotifyAlbumFull {
  id: string;
  name: string;
  album_type: string;
  total_tracks: number;
  release_date: string;
  artists: { name: string }[];
  images: { url: string }[];
  external_urls: { spotify: string };
  tracks: { items: { duration_ms: number; name: string }[]; next: string | null };
  copyrights?: { text: string; type: string }[];
}

/** インスト・別バージョン・ライブ等、カップリングの水増しになりがちな曲名 */
const VARIANT_TRACK = /instrumental|\binst\b|off vocal|karaoke|\blive\b|\btour\b|\s-\sfrom\s|remix|\bver\.|version|acoustic|tv size|radio edit/i;

/**
 * 原盤（℗）の年が配信日より2年以上前なら再発とみなす。
 * 旧譜の配信開始は release_date が配信日になるため、日付だけでは見分けられない
 */
function reissueYear(album: SpotifyAlbumFull): number | null {
  const releaseYear = Number(album.release_date.slice(0, 4));
  const years = (album.copyrights ?? [])
    .filter((c) => c.type === "P")
    .flatMap((c) => (c.text.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number));
  if (years.length === 0 || !releaseYear) return null;
  const earliest = Math.min(...years);
  return earliest <= releaseYear - 2 ? earliest : null;
}

async function fetchJson(url: string, token: string) {
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  for (let i = 0; i < 3 && res.status === 429; i++) {
    const header = Number(res.headers.get("retry-after"));
    await sleep(Math.min(Number.isFinite(header) && header > 0 ? header : 2 ** i, 15) * 1000);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  }
  if (!res.ok) throw new Error(`Spotify API エラー (${res.status})`);
  return res.json();
}

function releaseDateIso(value: string): string {
  const [y, m = "01", d = "01"] = (value ?? "").split("-");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * 邦楽：New Music Wednesday の収録曲からアルバム・EPの候補を作る。
 *
 * 種別の判定は既存の追加ボタン（/api/sheets/add-album）と同じ。
 * Spotify の album_type が album ならアルバム、single でも4曲以上ならEP、
 * それ未満はシングルとして対象外にする。
 */
export async function japaneseCandidates(playlistUrl: string, window: WeekWindow): Promise<{ playlistName: string; candidates: Candidate[] }> {
  const playlistId = parsePlaylistId(playlistUrl);
  if (!playlistId) throw new Error("プレイリストのURLが設定されていません");

  const embed = await fetchEmbedPlaylist(playlistId);
  const token = await getAccessToken();

  // 曲 → アルバムID（収録順を保つ）
  const albumOrder: string[] = [];
  const trackIds = embed.tracks.map((t) => t.trackId);
  for (let i = 0; i < trackIds.length; i += 50) {
    const data = await fetchJson(`https://api.spotify.com/v1/tracks?ids=${trackIds.slice(i, i + 50).join(",")}&market=JP`, token);
    for (const track of data.tracks ?? []) {
      const id = track?.album?.id;
      if (id && !albumOrder.includes(id)) albumOrder.push(id);
    }
    await sleep(150);
  }

  // アルバムの詳細（曲数・総尺・カバー）
  const albums: SpotifyAlbumFull[] = [];
  for (let i = 0; i < albumOrder.length; i += 20) {
    const data = await fetchJson(`https://api.spotify.com/v1/albums?ids=${albumOrder.slice(i, i + 20).join(",")}&market=JP`, token);
    for (const album of data.albums ?? []) if (album?.id) albums.push(album);
    await sleep(150);
  }

  const { keys, albumIds, artists } = await readExistingKeys();
  const candidates: Candidate[] = [];
  for (const album of albums) {
    let totalMs = album.tracks.items.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0);
    let next = album.tracks.next;
    while (next) {
      const page = await fetchJson(next, token);
      totalMs += (page.items ?? []).reduce((sum: number, t: { duration_ms: number }) => sum + (t.duration_ms ?? 0), 0);
      next = page.next;
    }

    // シングルでも4曲以上ならEP。ただしインスト・別バージョンを除いて4曲に満たないものはシングル扱い
    const originals = album.tracks.items.filter((t) => !VARIANT_TRACK.test(t.name ?? "")).length
      + Math.max(0, album.total_tracks - album.tracks.items.length);
    const isEp = album.album_type === "single" && album.total_tracks >= 4 && originals >= 4;
    const type = album.album_type === "album" ? "アルバム"
      : isEp ? "EP"
      : album.album_type === "compilation" ? "コンピレーション"
      : "シングル";
    const artist = album.artists.map((a) => a.name).join(", ");
    const title = isEp ? `[EP] ${album.name}` : album.name;
    const date = releaseDateIso(album.release_date);
    const reissuedFrom = reissueYear(album);

    candidates.push({
      id: `sp-${album.id}`,
      source: "spotify",
      date,
      title,
      artist,
      waboku: "邦楽",
      type,
      excludeReason: type === "シングル" ? "シングル"
        : type === "コンピレーション" ? "コンピレーション"
        : reissuedFrom ? `リイシュー（℗${reissuedFrom}）`
        : excludeReasonFor(album.name, ""),
      existingRow: albumIds.get(album.id) ?? keys.get(releaseKey(title, artist))
        ?? sameArtistNearby(artists, album.artists.map((a) => a.name), date),
      inWeek: isInWeek(toSheetDate(date), window),
      spotifyUrl: album.external_urls.spotify,
      coverUrl: album.images?.[0]?.url ?? "",
      trackCount: album.total_tracks,
      totalDurationMs: totalMs,
    });
  }

  return { playlistName: embed.name, candidates };
}

// ── 追加 ──

export interface NewRelease {
  date: string;
  title: string;
  artist: string;
  waboku: "洋楽" | "邦楽";
  spotifyUrl?: string;
  coverUrl?: string;
  trackCount?: number;
  totalDurationMs?: number;
}

export interface AddReleasesResult {
  added: { rowNum: number; title: string; artist: string }[];
  /** 追加直前の再確認で既にあった作品 */
  skipped: { title: string; artist: string; existingRow: number }[];
}

/**
 * 候補を Release Master の末尾に追記する。
 *
 * 画面で候補を出してから追加するまでの間に、別のメンバーが同じ作品を
 * 足しているかもしれないので、書き込む直前にもう一度重複を確かめる。
 * 数式（E・H・O列など）が入っている列には触れず、値のある列だけを書く。
 * No.列（A列）の数式は途中で途切れているため、空なら "=ROW()-1" を入れる。
 */
export async function addReleases(releases: NewRelease[]): Promise<AddReleasesResult> {
  const { sheets, spreadsheetId, dataRows, col } = await readSheet();
  const titleIdx = getCol(col, "TITLE"), artistIdx = getCol(col, "ARTIST");

  const existing = new Map<string, number>();
  let lastFilled = -1;
  dataRows.forEach((row, i) => {
    const title = (row[titleIdx] ?? "").trim(), artist = (row[artistIdx] ?? "").trim();
    if (title && artist) { existing.set(releaseKey(title, artist), i + 2); lastFilled = i; }
  });

  const result: AddReleasesResult = { added: [], skipped: [] };
  const valueWrites: { range: string; values: (string | number)[][] }[] = [];
  const enteredWrites: { range: string; values: string[][] }[] = [];
  let nextRow = lastFilled + 3; // dataRows[0] はシートの2行目

  const cell = (idx: number | undefined, rowNum: number) =>
    idx === undefined ? null : `${SHEET}!${indexToColumnLetter(idx)}${rowNum}`;

  for (const r of releases) {
    const title = r.title.trim(), artist = r.artist.trim();
    if (!title || !artist || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    const key = releaseKey(title, artist);
    const already = existing.get(key);
    if (already) { result.skipped.push({ title, artist, existingRow: already }); continue; }

    const rowNum = nextRow++;
    existing.set(key, rowNum);
    const noValue = (dataRows[rowNum - 2]?.[getCol(col, "NO")] ?? "").trim();
    if (!noValue) enteredWrites.push({ range: cell(getCol(col, "NO"), rowNum)!, values: [["=ROW()-1"]] });
    // 日付は USER_ENTERED（RAW だと文字列扱いになり先頭に ' が付く）
    enteredWrites.push({ range: cell(getCol(col, "DATE"), rowNum)!, values: [[toSheetDate(r.date)]] });

    const plain: [number | undefined, string | number][] = [
      [titleIdx, title],
      [artistIdx, artist],
      [getCol(col, "GENRE"), r.waboku],
      [col[SHEET_COL.UID], generateAlbumUid()],
    ];
    if (r.spotifyUrl) plain.push([col[SHEET_COL.SPOTIFY_URL], r.spotifyUrl]);
    if (r.coverUrl) plain.push([col[SHEET_COL.COVER_URL], r.coverUrl]);
    if (r.trackCount && r.totalDurationMs) plain.push([getCol(col, "TIME"), formatTimeTracks(r.trackCount, r.totalDurationMs)]);
    for (const [idx, value] of plain) {
      const range = cell(idx, rowNum);
      if (range) valueWrites.push({ range, values: [[value]] });
    }
    result.added.push({ rowNum, title, artist });
  }

  if (result.added.length === 0) return result;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data: enteredWrites },
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: valueWrites },
  });
  return result;
}
