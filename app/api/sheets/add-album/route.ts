import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getWriteAuth } from "@/lib/release-master";
import { buildHeaderMap, SHEET_COL } from "@/lib/sheet-headers";

export const dynamic = "force-dynamic";

interface AddAlbumBody {
  title: string;
  artist: string;
  trackCount: number;
  totalDurationMs: number;
  coverUrl: string;
  spotifyUrl: string;
  tracks: { name: string; durationMs: number }[];
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}min ${sec}sec`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AddAlbumBody;
    const { title, artist, trackCount, totalDurationMs, coverUrl, spotifyUrl, tracks } = body;

    if (!title || !artist || !spotifyUrl) {
      return NextResponse.json({ error: "title, artist, spotifyUrl are required" }, { status: 400 });
    }

    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

    // Read header row and A column in parallel
    const [headerRes, noRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Release Master'!1:1",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Release Master'!A2:A",
      }),
    ]);

    // Resolve Spotify URL and cover URL columns dynamically from headers
    const col = buildHeaderMap(headerRes.data.values?.[0] ?? []);
    const totalCols = (headerRes.data.values?.[0] ?? []).length;
    const spotifyColIdx = col[SHEET_COL.SPOTIFY_URL] ?? -1;
    const coverColIdx   = col[SHEET_COL.COVER_URL]   ?? -1;
    const trackColIdx   = col[SHEET_COL.MJ_TRACK]     ?? 19;

    if (spotifyColIdx < 0) {
      return NextResponse.json({ error: `COLUMN_NOT_FOUND: ${SHEET_COL.SPOTIFY_URL}` }, { status: 500 });
    }

    // Determine next No.
    const noRows = noRes.data.values ?? [];
    let maxNo = 0;
    for (const row of noRows) {
      const n = parseInt(row[0] ?? "", 10);
      if (!isNaN(n) && n > maxNo) maxNo = n;
    }
    const nextNo = maxNo + 1;

    // Format today's date as YYYY/MM/DD
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

    // Track info: "Nsongs, Xmin Ysec"
    const trackInfo = `${trackCount}songs, ${formatDuration(totalDurationMs)}`;
    const firstTrackName = tracks[0]?.name ?? "";

    // Build row sized to cover all columns
    const rowSize = Math.max(totalCols, spotifyColIdx + 1, coverColIdx + 1);
    const rowData = new Array(rowSize).fill("");

    // Fixed-position columns (A–G, T) — these haven't moved
    rowData[0] = String(nextNo);
    rowData[1] = dateStr;
    rowData[2] = title;
    rowData[3] = artist;
    rowData[4] = `${title} / ${artist}`;
    rowData[5] = "洋楽";
    rowData[6] = trackInfo;
    rowData[trackColIdx] = firstTrackName;

    // Header-resolved columns
    rowData[spotifyColIdx] = spotifyUrl;
    if (coverColIdx >= 0) rowData[coverColIdx] = coverUrl;

    // Use append to safely add after the last row with data
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'Release Master'!A:A",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowData] },
    });

    return NextResponse.json({ ok: true, no: String(nextNo) });
  } catch (error) {
    console.error("add-album failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
