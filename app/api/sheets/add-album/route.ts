import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getWriteAuth } from "@/lib/release-master";
import { buildHeaderMap, SHEET_COL } from "@/lib/sheet-headers";

export const dynamic = "force-dynamic";

interface AddAlbumBody {
  title: string;
  artist: string;
  releaseDate: string;
  trackCount: number;
  totalDurationMs: number;
  coverUrl: string;
  spotifyUrl: string;
  tracks: { name: string; durationMs: number }[];
}

function formatReleaseDate(releaseDate: string): string {
  // Spotify returns "YYYY-MM-DD", "YYYY-MM", or "YYYY"
  const parts = releaseDate.split("-");
  const year  = parts[0] ?? "";
  const month = parts[1] ? parts[1].padStart(2, "0") : "01";
  const day   = parts[2] ? parts[2].padStart(2, "0") : "01";
  return `${year}/${month}/${day}`;
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
    const { title, artist, releaseDate, trackCount, totalDurationMs, coverUrl, spotifyUrl, tracks } = body;

    if (!title || !artist || !spotifyUrl) {
      return NextResponse.json({ error: "title, artist, spotifyUrl are required" }, { status: 400 });
    }

    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

    // ヘッダー行とデータ行（A〜D列）を同時取得
    const [headerRes, dataRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Release Master'!1:1",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Release Master'!A2:D",
      }),
    ]);

    const col = buildHeaderMap(headerRes.data.values?.[0] ?? []);
    const totalCols = (headerRes.data.values?.[0] ?? []).length;

    // 書き込み対象列をヘッダー名で解決
    const timeColIdx    = col["Time"]               ?? 6;   // G列
    const spotifyColIdx = col[SHEET_COL.SPOTIFY_URL] ?? -1;
    const coverColIdx   = col[SHEET_COL.COVER_URL]   ?? -1;

    if (spotifyColIdx < 0) {
      return NextResponse.json({ error: `COLUMN_NOT_FOUND: ${SHEET_COL.SPOTIFY_URL}` }, { status: 500 });
    }

    const dataRows = dataRes.data.values ?? [];

    // タイトル（C=index2）とアーティスト（D=index3）が両方空白の最初の行を探す
    let targetRowNum: number | null = null;
    for (let i = 0; i < dataRows.length; i++) {
      const rowTitle  = (dataRows[i][2] ?? "").trim();
      const rowArtist = (dataRows[i][3] ?? "").trim();
      if (!rowTitle && !rowArtist) {
        targetRowNum = i + 2; // ヘッダーが1行目なのでデータは2行目〜
        break;
      }
    }

    // maxNo を計算
    let maxNo = 0;
    for (const row of dataRows) {
      const n = parseInt(row[0] ?? "", 10);
      if (!isNaN(n) && n > maxNo) maxNo = n;
    }
    const nextNo = maxNo + 1;

    const trackInfo = `${trackCount}songs, ${formatDuration(totalDurationMs)}`;
    const dateStr = formatReleaseDate(releaseDate);

    const rowSize = Math.max(totalCols, spotifyColIdx + 1, coverColIdx + 1);
    const rowData = new Array(rowSize).fill("");
    // 書き込む列: No.(A), Date(B), Title(C), Artist(D), Time(G), Spotify, spotifyカバー
    rowData[0]             = String(nextNo);
    rowData[1]             = dateStr;
    rowData[2]             = title;
    rowData[3]             = artist;
    rowData[timeColIdx]    = trackInfo;
    rowData[spotifyColIdx] = spotifyUrl;
    if (coverColIdx >= 0) rowData[coverColIdx] = coverUrl;

    if (targetRowNum !== null) {
      // タイトル・アーティストが空白の既存行に上書き
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!A${targetRowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [rowData] },
      });
    } else {
      // 空白行がなければ末尾に追加
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "'Release Master'!A:A",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [rowData] },
      });
    }

    return NextResponse.json({ ok: true, no: String(nextNo) });
  } catch (error) {
    console.error("add-album failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
