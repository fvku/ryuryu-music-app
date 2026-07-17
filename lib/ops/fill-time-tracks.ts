/**
 * Release Master の Time列が空のアルバムを Spotify から補完するコアロジック。
 * scripts/fill-time-tracks.ts（CLI）と app/api/admin/fill-time-tracks（管理画面）の共通実装。
 *
 * 動作:
 *   1. Time が空の行を抽出（force なら既存値も上書き）
 *   2. Spotify列に URL がある行のみ対象（URLがない行は検索せずスキップ＝シングル/同名EP誤爆を防止）
 *   3. トラック一覧から総再生時間と曲数を算出し "12songs, 46min 20sec" 形式で書き込む
 */

import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";
import { indexToColumnLetter } from "@/lib/sheet-headers";

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── Spotify ──

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Spotify credentials not set");
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  const data = await res.json();
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.accessToken;
}

function extractAlbumId(spotifyUrl: string): string | null {
  const m = spotifyUrl.match(/album\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function getAlbumInfo(albumId: string): Promise<{ totalTracks: number; totalDurationMs: number }> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.spotify.com/v1/albums/${albumId}?market=JP`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Album API error: ${await res.text()}`);
  const data = await res.json();

  const totalTracks: number = data.total_tracks;
  let totalMs: number = data.tracks.items.reduce((sum: number, t: { duration_ms: number }) => sum + t.duration_ms, 0);

  // 50曲超のアルバムはページネーション
  let nextUrl: string | null = data.tracks.next;
  while (nextUrl) {
    const pageRes = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!pageRes.ok) break;
    const pageData = await pageRes.json();
    totalMs += pageData.items.reduce((sum: number, t: { duration_ms: number }) => sum + t.duration_ms, 0);
    nextUrl = pageData.next;
    await sleep(100);
  }

  return { totalTracks, totalDurationMs: totalMs };
}

function formatEntry(totalMs: number, totalTracks: number): string {
  const totalSec = Math.round(totalMs / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${totalTracks}songs, ${totalMin}min ${sec}sec`;
}

// ── コア処理 ──

export interface FillTimeTracksOptions {
  /** false = dry-run（書き込まない） */
  apply: boolean;
  /** 既存のTime値も上書き（CLI --force） */
  force?: boolean;
  /** 指定行以降のみ対象（CLI --from-row） */
  fromRow?: number;
  /** 先頭からN件のみ処理（API側のタイムアウト対策） */
  limit?: number;
  log?: (msg: string) => void;
}

export interface FillTimeTracksDetail {
  row: number;
  artist: string;
  title: string;
  result: string;
}

export interface FillTimeTracksResult {
  ok: number;
  skipNotFound: number;
  skipNoUrl: number;
  total: number;
  written: number;
  details: FillTimeTracksDetail[];
}

export async function fillTimeTracks(options: FillTimeTracksOptions): Promise<FillTimeTracksResult> {
  const { apply, force = false, fromRow = 1, limit, log = () => {} } = options;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col: Record<string, number> = {};
  headerRow.forEach((cell: string, i: number) => { if (cell?.trim()) col[cell.trim()] = i; });

  const timeIdx    = col["Time"]    ?? 6;
  const spotifyIdx = col["Spotify"] ?? 29;
  const noIdx      = col["No."]     ?? 0;
  const titleIdx   = col["Title"]   ?? 2;
  const artistIdx  = col["Artist"]  ?? 3;

  const cTime = indexToColumnLetter(timeIdx);

  const candidates = dataRows
    .map((row, i) => ({
      rowNum:  i + 2,
      no:      (row[noIdx]      ?? "").trim(),
      title:   (row[titleIdx]   ?? "").trim(),
      artist:  (row[artistIdx]  ?? "").trim(),
      time:    (row[timeIdx]    ?? "").trim(),
      spotify: (row[spotifyIdx] ?? "").trim(),
    }))
    .filter((r) => r.no && r.title && r.rowNum >= fromRow && (force || !r.time));

  const skipNoUrl = candidates.filter((r) => !r.spotify.startsWith("https://open.spotify.com/album/")).length;
  const allTargets = candidates.filter((r) => r.spotify.startsWith("https://open.spotify.com/album/"));

  const targets = limit !== undefined ? allTargets.slice(0, limit) : allTargets;

  const result: FillTimeTracksResult = {
    ok: 0, skipNotFound: 0, skipNoUrl,
    total: targets.length, written: 0, details: [],
  };

  log(`Time が空でSpotify URLがある行: ${targets.length} 件（URLなしのため対象外: ${skipNoUrl} 件）`);
  if (targets.length === 0) return result;

  const writes: { range: string; values: string[][] }[] = [];
  const pushDetail = (t: { rowNum: number; artist: string; title: string }, msg: string) => {
    result.details.push({ row: t.rowNum, artist: t.artist, title: t.title, result: msg });
    log(`[row${t.rowNum}] ${t.artist} - ${t.title} ... ${msg}`);
  };

  for (const t of targets) {
    try {
      const albumId = extractAlbumId(t.spotify);

      if (!albumId) {
        pushDetail(t, "SKIP（アルバムID取得失敗）");
        result.skipNotFound++;
        continue;
      }

      const info = await getAlbumInfo(albumId);
      const entry = formatEntry(info.totalDurationMs, info.totalTracks);
      pushDetail(t, entry);
      writes.push({ range: `'Release Master'!${cTime}${t.rowNum}`, values: [[entry]] });
      result.ok++;
    } catch (e) {
      pushDetail(t, `ERROR: ${e}`);
      result.skipNotFound++;
    }

    await sleep(300);
  }

  if (apply && writes.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: writes },
    });
    result.written = writes.length;
    log(`\n完了: ${writes.length} セルを書き込みました。`);
  }

  return result;
}
