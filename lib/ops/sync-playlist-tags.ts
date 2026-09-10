/**
 * 指定プレイリストの収録曲を取得し、Release Master の各行に
 * 「どのプレイリストに入っているか」を書き込むコアロジック。
 *
 * Spotify公式プレイリストは Web API から読めない（Development mode のアプリは 404）。
 * そのため収録曲一覧だけは埋め込みページから取得し、
 * 曲→アルバムの解決は公式 API（/v1/tracks）で行う。
 * 埋め込みから取れるのは先頭100曲までで、新しい順に並んでいる。
 *
 * scripts/sync-playlist-tags.ts（CLI）と app/api/admin/sync-playlist-tags（管理画面）の共通実装。
 */

import { google } from "googleapis";
import { getAccessToken } from "@/lib/spotify";
import { getGoogleAuth } from "@/lib/google-auth";
import {
  buildHeaderMap,
  indexToColumnLetter,
  SHEET_COL,
} from "@/lib/sheet-headers";
import {
  parseAlbumId,
  parsePlaylistId,
  readActivePlaylistSources,
  type PlaylistSource,
} from "@/lib/playlist-sources";

const EMBED_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** 429（レート制限）は Retry-After に従って数回まで待ち直す */
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

/** 同時実行数を絞って順に処理する */
async function runPooled<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await task(item);
    }
  });
  await Promise.all(workers);
}

function norm(s: string) { return (s ?? "").trim().toLowerCase(); }

/** [EP], [Single] 等のプレフィックスを除去（refetch-spotify と同じ扱い） */
function stripTypePrefix(s: string) {
  return (s ?? "").replace(/^\[(EP|Single|Album|Compilation)\]\s*/i, "").trim();
}

/** アーティスト名を比較用に正規化（& ↔ , の揺れを吸収） */
function normArtist(s: string) { return norm(s).replace(/\s*&\s*/g, ", "); }

/** アルバム名＋アーティスト名の照合キー */
function albumKey(title: string, artist: string) {
  return `${norm(stripTypePrefix(title))}::${normArtist(artist)}`;
}

interface EmbedTrack { trackId: string; title: string; subtitle: string; }

/**
 * 埋め込みページから収録曲を取得する。
 * 公式 API では読めないプレイリストが対象。取得上限は100曲。
 */
async function fetchEmbedTracks(playlistId: string): Promise<{ name: string; tracks: EmbedTrack[] }> {
  const res = await fetchWithRetry(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { "User-Agent": EMBED_UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`埋め込みページの取得に失敗しました (${res.status})`);

  const html = await res.text();
  const matched = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!matched) throw new Error("埋め込みページの構造が変わっています（__NEXT_DATA__ が見つかりません）");

  let entity: { name?: string; trackList?: { uri?: string; title?: string; subtitle?: string }[] };
  try {
    entity = JSON.parse(matched[1])?.props?.pageProps?.state?.data?.entity ?? {};
  } catch {
    throw new Error("埋め込みページのJSONを解析できませんでした");
  }

  const tracks: EmbedTrack[] = (entity.trackList ?? [])
    .filter((t) => typeof t?.uri === "string" && t.uri.startsWith("spotify:track:"))
    .map((t) => ({
      trackId: t.uri!.split(":").pop()!,
      title: t.title ?? "",
      subtitle: t.subtitle ?? "",
    }));

  return { name: entity.name ?? "", tracks };
}

interface TrackAlbum { albumId: string; albumName: string; albumArtist: string; }

/**
 * トラックIDからアルバム情報を引く（公式API、50件ずつ）。
 *
 * market を指定すると Track Relinking が働き、その市場で配信されている版の
 * アルバムIDが返る。Release Master の Spotify URL は market=JP の検索で
 * 取得しているため、market なしの結果だけだと同じ作品でもIDが食い違うことがある。
 * 呼び出し側で両方を索引に入れて取りこぼしを防ぐ。
 */
async function resolveAlbums(
  trackIds: string[],
  token: string,
  market?: string
): Promise<{ albums: Map<string, TrackAlbum>; errors: string[] }> {
  const out = new Map<string, TrackAlbum>();
  const errors: string[] = [];

  for (let i = 0; i < trackIds.length; i += 50) {
    const chunk = trackIds.slice(i, i + 50);
    const marketParam = market ? `&market=${market}` : "";
    const res = await fetchWithRetry(`https://api.spotify.com/v1/tracks?ids=${chunk.join(",")}${marketParam}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      // 1チャンク落ちても全体は続行する（追記方式なので再実行で埋まる）
      errors.push(`トラック情報の取得に失敗しました (${res.status})`);
      continue;
    }

    const data = await res.json();
    for (const track of data.tracks ?? []) {
      if (!track?.id || !track?.album?.id) continue;
      out.set(track.id, {
        albumId: track.album.id,
        albumName: track.album.name ?? "",
        albumArtist: (track.album.artists ?? []).map((a: { name: string }) => a.name).join(", "),
      });
    }
    if (i + 50 < trackIds.length) await sleep(120);
  }

  return { albums: out, errors };
}

export interface PlaylistIndex {
  /** アルバムID → プレイリスト表示名 */
  byAlbumId: Map<string, Set<string>>;
  /** アルバム名::アーティスト名 → プレイリスト表示名 */
  byAlbumKey: Map<string, Set<string>>;
  /** 取得できたプレイリストごとの曲数 */
  fetched: { label: string; playlistId: string; trackCount: number }[];
  /** 取得に失敗したプレイリスト */
  failed: { label: string; playlistId: string; error: string }[];
}

/**
 * 登録済みプレイリストを走査して、アルバム→プレイリスト名の索引を作る。
 *
 * 収録曲の取得（埋め込みページ）は並列で行い、
 * アルバムの解決（公式API）は全プレイリスト分をまとめて1本の直列処理にする。
 * 公式APIを並列で叩くとレート制限（429）に当たるため。
 */
export async function buildPlaylistIndex(
  sources: PlaylistSource[],
  log: (msg: string) => void = () => {}
): Promise<PlaylistIndex> {
  const token = await getAccessToken();
  const index: PlaylistIndex = {
    byAlbumId: new Map(), byAlbumKey: new Map(), fetched: [], failed: [],
  };

  const add = (map: Map<string, Set<string>>, key: string, label: string) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(label);
  };

  // 1) 埋め込みページを並列取得（公式APIではないのでレート制限とは無関係）
  const fetchedPlaylists: { source: PlaylistSource; playlistId: string; tracks: EmbedTrack[] }[] = [];
  await runPooled(sources, 5, async (source) => {
    const playlistId = parsePlaylistId(source.playlistId);
    try {
      const { tracks } = await fetchEmbedTracks(playlistId);
      if (tracks.length === 0) throw new Error("収録曲を取得できませんでした");
      fetchedPlaylists.push({ source, playlistId, tracks });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      index.failed.push({ label: source.label, playlistId, error });
      log(`  ${source.label}: 取得失敗 (${error})`);
    }
  });

  // 2) 全プレイリスト分のトラックをまとめて解決する
  const uniqueTrackIds = [...new Set(fetchedPlaylists.flatMap((p) => p.tracks.map((t) => t.trackId)))];
  log(`  収録曲 ${uniqueTrackIds.length}件のアルバムを解決中...`);

  const resolved = new Map<string, TrackAlbum[]>();
  const resolveErrors: string[] = [];
  for (const market of [undefined, "JP"]) {
    const { albums, errors } = await resolveAlbums(uniqueTrackIds, token, market);
    resolveErrors.push(...errors);
    for (const [trackId, album] of albums) {
      const list = resolved.get(trackId) ?? [];
      if (!list.some((a) => a.albumId === album.albumId)) list.push(album);
      resolved.set(trackId, list);
    }
  }
  if (resolveErrors.length > 0) {
    index.failed.push({
      label: "アルバム解決",
      playlistId: "-",
      error: `${resolveErrors.length}件のリクエストが失敗しました（${resolveErrors[0]}）。再実行すると埋まります`,
    });
  }

  // 3) プレイリストごとに索引へ流し込む
  for (const { source, playlistId, tracks } of fetchedPlaylists) {
    const albumIds = new Set<string>();
    for (const track of tracks) {
      for (const { albumId, albumName, albumArtist } of resolved.get(track.trackId) ?? []) {
        albumIds.add(albumId);
        add(index.byAlbumId, albumId, source.label);
        add(index.byAlbumKey, albumKey(albumName, albumArtist), source.label);
      }
    }
    index.fetched.push({ label: source.label, playlistId, trackCount: tracks.length });
    log(`  ${source.label}: ${tracks.length}曲 / アルバム ${albumIds.size}枚`);
  }

  index.fetched.sort((a, b) => a.label.localeCompare(b.label));
  return index;
}

export interface PlaylistTagChange {
  rowNum: number;
  title: string;
  artist: string;
  before: string;
  after: string;
  /** 今回新しく追加されたプレイリスト名 */
  added: string[];
  matchedBy: "albumId" | "titleArtist";
}

/** セルの値をプレイリスト名の配列に分解する */
function splitLabels(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export interface SyncPlaylistTagsOptions {
  /** false = dry-run（書き込まない） */
  apply: boolean;
  /** playlist列が無いときにヘッダーを作る */
  initColumn?: boolean;
  log?: (msg: string) => void;
}

export interface SyncPlaylistTagsResult {
  index: PlaylistIndex;
  changes: PlaylistTagChange[];
  unchanged: number;
  written: number;
  /** 索引には在るが Release Master のどの行とも結び付かなかったアルバム */
  unmatchedAlbums: number;
}

export async function syncPlaylistTags(
  options: SyncPlaylistTagsOptions
): Promise<SyncPlaylistTagsResult> {
  const { apply, initColumn = false, log = () => {} } = options;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sources = await readActivePlaylistSources();
  if (sources.length === 0) throw new Error("対象プレイリストが登録されていません（管理画面から追加してください）");

  log(`プレイリスト ${sources.length} 本を取得中...`);
  const index = await buildPlaylistIndex(sources, log);
  if (index.fetched.length === 0) throw new Error("どのプレイリストも取得できませんでした");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  log("Release Master を読み込み中...");
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  let playlistIdx = col[SHEET_COL.PLAYLIST];
  if (playlistIdx === undefined) {
    const emptyIdx = headerRow.findIndex((h: string) => !(h ?? "").trim());
    const target = emptyIdx >= 0 ? emptyIdx : headerRow.length;
    if (!initColumn) {
      throw new Error(
        `"${SHEET_COL.PLAYLIST}" 列がありません。--init-column を付けて実行すると ` +
        `${indexToColumnLetter(target)}列 にヘッダーを作成します`
      );
    }
    if (apply) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!${indexToColumnLetter(target)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [[SHEET_COL.PLAYLIST]] },
      });
      log(`${indexToColumnLetter(target)}1 に "${SHEET_COL.PLAYLIST}" ヘッダーを作成しました`);
    } else {
      log(`(dry-run) ${indexToColumnLetter(target)}1 に "${SHEET_COL.PLAYLIST}" ヘッダーを作成します`);
    }
    playlistIdx = target;
  }

  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL];
  const titleIdx   = col["Title"]  ?? col["アルバム名"] ?? 2;
  const artistIdx  = col["Artist"] ?? col["アーティスト"] ?? 3;
  if (spotifyIdx === undefined) throw new Error(`"${SHEET_COL.SPOTIFY_URL}" 列が見つかりません`);

  const matchedAlbumIds = new Set<string>();
  const changes: PlaylistTagChange[] = [];
  let unchanged = 0;

  dataRows.forEach((row, i) => {
    const title  = (row[titleIdx] ?? "").trim();
    const artist = (row[artistIdx] ?? "").trim();
    const before = (row[playlistIdx] ?? "").trim();

    const albumId = parseAlbumId(row[spotifyIdx] ?? "");
    let labels = albumId ? index.byAlbumId.get(albumId) : undefined;
    let matchedBy: PlaylistTagChange["matchedBy"] = "albumId";

    if (!labels && (title || artist)) {
      labels = index.byAlbumKey.get(albumKey(title, artist));
      matchedBy = "titleArtist";
    }
    if (!labels || labels.size === 0) return;

    if (albumId) matchedAlbumIds.add(albumId);

    // 追記方式: 既に書かれている名前は消さない。
    // 埋め込みから取れるのは新しい順に100曲までなので、窓から外れたプレイリストを
    // 上書きで消してしまわないようにする。並び順も既存のものを保つ。
    const merged = splitLabels(before);
    const added: string[] = [];
    for (const label of [...labels].sort()) {
      if (merged.includes(label)) continue;
      merged.push(label);
      added.push(label);
    }

    const after = merged.join(", ");
    if (after === before) { unchanged += 1; return; }

    changes.push({ rowNum: i + 2, title, artist, before, after, added, matchedBy });
  });

  log(`\n索引: アルバム ${index.byAlbumId.size}枚 / 更新対象 ${changes.length}行 / 変更なし ${unchanged}行`);

  let written = 0;
  if (apply && changes.length > 0) {
    const colLetter = indexToColumnLetter(playlistIdx);
    for (let i = 0; i < changes.length; i += 200) {
      const chunk = changes.slice(i, i + 200);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: chunk.map((c) => ({
            range: `'Release Master'!${colLetter}${c.rowNum}`,
            values: [[c.after]],
          })),
        },
      });
      written += chunk.length;
      log(`  書き込み ${written}/${changes.length}`);
    }
  }

  return {
    index,
    changes,
    unchanged,
    written,
    unmatchedAlbums: index.byAlbumId.size - matchedAlbumIds.size,
  };
}
