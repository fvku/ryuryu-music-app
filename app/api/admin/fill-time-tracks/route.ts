import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

interface SearchResult { albumId: string; spotifyUrl: string; releaseDate: string; }

async function searchAlbum(artist: string, title: string): Promise<SearchResult | null> {
  const token = await getAccessToken();
  const q = encodeURIComponent(`${artist} ${title}`);
  const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=album&limit=1&market=JP`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const item = data.albums?.items?.[0];
  if (!item) return null;
  const albumId = extractAlbumId(item.external_urls.spotify);
  if (!albumId) return null;
  return { albumId, spotifyUrl: item.external_urls.spotify, releaseDate: item.release_date };
}

function datesMatch(sheetDate: string, spotifyDate: string): boolean {
  if (!sheetDate || !spotifyDate) return false;
  const normalized = sheetDate.replace(/\//g, "-");
  return normalized.startsWith(spotifyDate) || spotifyDate.startsWith(normalized);
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
  let nextUrl: string | null = data.tracks.next;
  while (nextUrl) {
    const pageRes = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!pageRes.ok) break;
    const pageData = await pageRes.json();
    totalMs += pageData.items.reduce((sum: number, t: { duration_ms: number }) => sum + t.duration_ms, 0);
    nextUrl = pageData.next;
    await new Promise(r => setTimeout(r, 100));
  }
  return { totalTracks, totalDurationMs: totalMs };
}

function formatEntry(totalMs: number, totalTracks: number): string {
  const totalSec = Math.round(totalMs / 1000);
  return `${totalTracks}songs, ${Math.floor(totalSec / 60)}min ${totalSec % 60}sec`;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function POST(req: NextRequest) {
  const { adminPassword, dryRun = true, limit = 15 } = await req.json();
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AE" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) return NextResponse.json({ error: "データが見つかりません" }, { status: 404 });

  const [headerRow, ...dataRows] = allRows;
  const col: Record<string, number> = {};
  headerRow.forEach((cell: string, i: number) => { if (cell?.trim()) col[cell.trim()] = i; });

  const timeIdx    = col["Time"]    ?? 6;
  const spotifyIdx = col["Spotify"] ?? 29;
  const noIdx      = col["No."]     ?? 0;
  const dateIdx    = col["Date"]    ?? 1;
  const titleIdx   = col["Title"]   ?? 2;
  const artistIdx  = col["Artist"]  ?? 3;

  const cTime    = colLetter(timeIdx);
  const cSpotify = colLetter(spotifyIdx);

  const targets = dataRows
    .map((row, i) => ({
      rowNum:  i + 2,
      no:      (row[noIdx]      ?? "").trim(),
      date:    (row[dateIdx]    ?? "").trim(),
      title:   (row[titleIdx]   ?? "").trim(),
      artist:  (row[artistIdx]  ?? "").trim(),
      time:    (row[timeIdx]    ?? "").trim(),
      spotify: (row[spotifyIdx] ?? "").trim(),
    }))
    .filter(r => r.no && r.title && !r.time)
    .slice(0, Math.min(limit, 20));

  type WriteData = { range: string; values: string[][] };
  const writes: WriteData[] = [];
  type Detail = { row: number; artist: string; title: string; result: string };
  const details: Detail[] = [];
  let ok = 0, skipNotFound = 0, skipDateMismatch = 0;

  for (const t of targets) {
    try {
      let albumId: string | null = null;

      if (t.spotify.startsWith("https://open.spotify.com/album/")) {
        albumId = extractAlbumId(t.spotify);
      } else {
        const result = await searchAlbum(t.artist, t.title);
        await sleep(200);

        if (!result) {
          details.push({ row: t.rowNum, artist: t.artist, title: t.title, result: "SKIP（Spotifyで見つからず）" });
          skipNotFound++;
          continue;
        }

        if (t.date && !datesMatch(t.date, result.releaseDate)) {
          details.push({ row: t.rowNum, artist: t.artist, title: t.title, result: `SKIP（日付不一致: sheet=${t.date}, spotify=${result.releaseDate}）` });
          skipDateMismatch++;
          continue;
        }

        albumId = result.albumId;
        writes.push({ range: `'Release Master'!${cSpotify}${t.rowNum}`, values: [[result.spotifyUrl]] });
      }

      if (!albumId) {
        details.push({ row: t.rowNum, artist: t.artist, title: t.title, result: "SKIP（ID取得失敗）" });
        skipNotFound++;
        continue;
      }

      const info = await getAlbumInfo(albumId);
      const entry = formatEntry(info.totalDurationMs, info.totalTracks);
      details.push({ row: t.rowNum, artist: t.artist, title: t.title, result: entry });
      writes.push({ range: `'Release Master'!${cTime}${t.rowNum}`, values: [[entry]] });
      ok++;
    } catch (e) {
      details.push({ row: t.rowNum, artist: t.artist, title: t.title, result: `ERROR: ${e}` });
      skipNotFound++;
    }

    await sleep(300);
  }

  if (!dryRun && writes.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: writes },
    });
  }

  return NextResponse.json({ ok, skipNotFound, skipDateMismatch, total: targets.length, details, dryRun });
}
