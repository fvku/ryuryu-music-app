import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SPOTIFY_ALBUM_RE = /open\.spotify\.com\/(?:[^/]+\/)?album\/([A-Za-z0-9]+)/;

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

async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function fetchCoverUrl(albumId: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json() as { images?: { url: string }[] };
  return data.images?.[0]?.url ?? null;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function POST(req: NextRequest) {
  const { adminPassword, limit = 20 } = await req.json();
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) return NextResponse.json({ error: "データが見つかりません" }, { status: 404 });

  const [headerRow, ...dataRows] = allRows;
  const colMap: Record<string, number> = {};
  headerRow.forEach((h: string, i: number) => { if (h) colMap[h.trim()] = i; });

  const spotifyIdx = colMap["Spotify"] ?? 29;
  const coverIdx   = colMap["spotifyカバー"] ?? 30;
  const noIdx      = colMap["No."] ?? 0;
  const titleIdx   = colMap["Title"] ?? 2;
  const coverColLetter = colLetter(coverIdx);

  const targets = dataRows
    .map((row, i) => ({
      rowNum: i + 2,
      no:     (row[noIdx]      ?? "").trim(),
      title:  (row[titleIdx]   ?? "").trim(),
      spotifyUrl:   (row[spotifyIdx] ?? "").trim(),
      currentCover: (row[coverIdx]   ?? "").trim(),
    }))
    .filter(r => {
      if (!r.spotifyUrl) return false;
      return SPOTIFY_ALBUM_RE.test(r.spotifyUrl) && !r.currentCover;
    })
    .slice(0, Math.min(limit, 30));

  if (targets.length === 0) {
    return NextResponse.json({ total: 0, fixed: 0, failed: 0, noChange: 0, message: "補完対象なし" });
  }

  const token = await getSpotifyToken();
  let fixed = 0, failed = 0, noChange = 0;

  for (const t of targets) {
    const match = t.spotifyUrl.match(SPOTIFY_ALBUM_RE);
    if (!match) { failed++; continue; }
    const albumId = match[1];

    const newCover = await fetchCoverUrl(albumId, token);
    if (!newCover) { failed++; await sleep(200); continue; }
    if (newCover === t.currentCover) { noChange++; await sleep(200); continue; }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Release Master'!${coverColLetter}${t.rowNum}`,
      valueInputOption: "RAW",
      requestBody: { values: [[newCover]] },
    });

    fixed++;
    await sleep(200);
  }

  return NextResponse.json({ total: targets.length, fixed, failed, noChange });
}
