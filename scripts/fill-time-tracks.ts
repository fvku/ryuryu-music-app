/**
 * Release Master の Time列(G) が空のアルバムを Spotify から補完する。
 *
 * 動作:
 *   1. Release Master を読み込み、Time が空の行を抽出（--force なら既存値も上書き）
 *   2. Spotify列(AD) に URL があればそのアルバムIDを使用、なければ検索
 *   3. Spotify Album API でトラック一覧を取得し、総再生時間と曲数を算出
 *   4. Time列 → "12songs, 46min 20sec" 形式で書き込む
 *
 * 実行方法:
 *   npx tsx scripts/fill-time-tracks.ts                   # dry-run（空のみ）
 *   npx tsx scripts/fill-time-tracks.ts --apply           # 書き込み（空のみ）
 *   npx tsx scripts/fill-time-tracks.ts --apply --force   # 書き込み（全上書き）
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");

// ── Spotify ──────────────────────────────────────────────────────────────────

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

interface AlbumInfo {
  totalTracks: number;
  totalDurationMs: number;
}

async function getAlbumInfo(albumId: string): Promise<AlbumInfo> {
  const token = await getAccessToken();

  // アルバム基本情報（total_tracks + 最初の50曲）
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

async function searchAlbumId(artist: string, title: string): Promise<string | null> {
  const token = await getAccessToken();
  const q = encodeURIComponent(`${artist} ${title}`);
  const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=album&limit=1&market=JP`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const item = data.albums?.items?.[0];
  return item ? extractAlbumId(item.external_urls.spotify) : null;
}

function formatEntry(totalMs: number, totalTracks: number): string {
  const totalSec = Math.round(totalMs / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${totalTracks}songs, ${totalMin}min ${sec}sec`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Google Sheets ─────────────────────────────────────────────────────────────

function getWriteAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try { credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8")); }
  catch { credentials = JSON.parse(keyJson); }
  if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  return new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
}

function colLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`モード: ${apply ? "APPLY（書き込みあり）" : "DRY-RUN（書き込みなし）"}${force ? " + FORCE（全上書き）" : ""}\n`);

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AE",
  });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col: Record<string, number> = {};
  headerRow.forEach((cell: string, i: number) => { if (cell?.trim()) col[cell.trim()] = i; });

  const timeIdx    = col["Time"] ?? 6;
  const trackIdx   = col["#"]    ?? 7;
  const spotifyIdx = col["Spotify"] ?? 29;
  const noIdx      = col["No."]  ?? 0;
  const titleIdx   = col["Title"]  ?? 2;
  const artistIdx  = col["Artist"] ?? 3;

  const cTime  = colLetter(timeIdx);
  const cTrack = colLetter(trackIdx);

  // Time が空の行を抽出（--force なら既存値があっても対象に含める）
  const targets = dataRows
    .map((row, i) => ({
      rowNum: i + 2,
      no:     (row[noIdx]      ?? "").trim(),
      title:  (row[titleIdx]   ?? "").trim(),
      artist: (row[artistIdx]  ?? "").trim(),
      time:   (row[timeIdx]    ?? "").trim(),
      tracks: (row[trackIdx]   ?? "").trim(),
      spotify:(row[spotifyIdx] ?? "").trim(),
    }))
    .filter((r) => r.no && r.title && (force || !r.time));

  console.log(`Time が空の行: ${targets.length} 件\n`);
  if (targets.length === 0) { console.log("対象なし。"); return; }

  type WriteData = { range: string; values: string[][] };
  const writes: WriteData[] = [];
  let ok = 0, skip = 0;

  for (const t of targets) {
    process.stdout.write(`[row${t.rowNum}] ${t.artist} - ${t.title} ... `);

    try {
      // SpotifyアルバムIDを解決
      let albumId: string | null = null;
      if (t.spotify.startsWith("https://open.spotify.com/album/")) {
        albumId = extractAlbumId(t.spotify);
      }
      if (!albumId) {
        albumId = await searchAlbumId(t.artist, t.title);
        await sleep(200);
      }

      if (!albumId) {
        console.log("SKIP（Spotifyで見つからず）");
        skip++;
        continue;
      }

      const info = await getAlbumInfo(albumId);
      const entry = formatEntry(info.totalDurationMs, info.totalTracks);

      console.log(entry);

      writes.push({ range: `'Release Master'!${cTime}${t.rowNum}`, values: [[entry]] });
      ok++;
    } catch (e) {
      console.log(`ERROR: ${e}`);
      skip++;
    }

    await sleep(300);
  }

  console.log(`\n結果: ${ok} 件取得, ${skip} 件スキップ`);

  if (!apply) {
    console.log("\n--- dry-run 完了。書き込むには --apply を付けて再実行してください。---");
    return;
  }

  if (writes.length === 0) { console.log("書き込みなし。"); return; }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: writes },
  });
  console.log(`\n完了: ${writes.length} セルを書き込みました。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
