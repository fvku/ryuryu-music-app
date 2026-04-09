import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getWriteAuth } from "@/lib/release-master";

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

    // Read A column to determine next No.
    const noRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A2:A",
    });
    const noRows = noRes.data.values ?? [];
    let maxNo = 0;
    for (const row of noRows) {
      const n = parseInt(row[0] ?? "", 10);
      if (!isNaN(n) && n > maxNo) maxNo = n;
    }
    const nextNo = maxNo + 1;
    const nextRow = noRows.length + 2; // header is row 1, data starts at row 2

    // Format today's date as YYYY/MM/DD
    const today = new Date();
    const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

    // Track info: "Nsongs, Xmin Ysec"
    const trackInfo = `${trackCount}songs, ${formatDuration(totalDurationMs)}`;

    // First track name for column T (index 19, 0-based)
    const firstTrackName = tracks[0]?.name ?? "";

    // Build sparse row: 30 elements (A=0 to AD=29)
    // A(0)=No., B(1)=Date, C(2)=Title, D(3)=Artist, E(4)=Title/Artist, F(5)=洋楽,
    // G(6)=trackInfo, T(19)=firstTrack, AC(28)=spotifyUrl, AD(29)=coverUrl
    const rowData = new Array(30).fill("");
    rowData[0]  = String(nextNo);
    rowData[1]  = dateStr;
    rowData[2]  = title;
    rowData[3]  = artist;
    rowData[4]  = `${title} / ${artist}`;
    rowData[5]  = "洋楽";
    rowData[6]  = trackInfo;
    rowData[19] = firstTrackName;
    rowData[28] = spotifyUrl;
    rowData[29] = coverUrl;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Release Master'!A${nextRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowData] },
    });

    return NextResponse.json({ ok: true, no: String(nextNo), rowNum: nextRow });
  } catch (error) {
    console.error("add-album failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
