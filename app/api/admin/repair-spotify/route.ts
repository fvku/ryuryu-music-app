import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { searchAlbums } from "@/lib/spotify";
import { buildHeaderMap, findMissingColumns, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";

export const dynamic = "force-dynamic";

// Vercel のデフォルトタイムアウトを超える可能性があるため延長
export const maxDuration = 60;

function getWriteAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  let credentials;
  try {
    const decoded = Buffer.from(keyJson, "base64").toString("utf-8");
    credentials = JSON.parse(decoded);
  } catch {
    try {
      credentials = JSON.parse(keyJson);
    } catch {
      credentials = JSON.parse(keyJson.replace(/\n/g, "\\n"));
    }
  }
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AC列（Spotify URL列）に誤ってカバー画像URL（https://i.scdn.co/image/...）が
 * 書き込まれている行を検出し、Spotify APIから正しいアルバムURLを再取得して修復する。
 */
export async function POST(req: NextRequest) {
  const { adminPassword } = await req.json();
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) {
    return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
  }

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  // ヘッダー＋全データ取得
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AD",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) {
    return NextResponse.json({ error: "データが見つかりません" }, { status: 404 });
  }

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  // 必要列の存在チェック
  const missing = findMissingColumns(col, [SHEET_COL.SPOTIFY_URL]);
  if (missing.length > 0) {
    return NextResponse.json({ error: `列が見つかりません: ${missing.join(", ")}` }, { status: 422 });
  }

  const noIdx     = col["No."]          ?? 0;
  const titleIdx  = col["アルバム名"]   ?? 2;
  const artistIdx = col["アーティスト"] ?? 3;
  const spotifyIdx = col[SHEET_COL.SPOTIFY_URL];
  const cSpotify  = indexToColumnLetter(spotifyIdx);

  // AC列がカバー画像URLになっている行を抽出
  const targets: { rowNum: number; no: string; title: string; artist: string }[] = [];
  dataRows.forEach((row, i) => {
    const current = (row[spotifyIdx] ?? "").trim();
    if (current.startsWith("https://i.scdn.co/image/")) {
      targets.push({
        rowNum: i + 2, // 1-based, +1 for header row
        no:     row[noIdx]     ?? "",
        title:  row[titleIdx]  ?? "",
        artist: row[artistIdx] ?? "",
      });
    }
  });

  if (targets.length === 0) {
    return NextResponse.json({ total: 0, fixed: 0, failed: 0, details: [], message: "修復対象なし" });
  }

  // 各行を順次修復
  const details: { no: string; title: string; artist: string; newUrl: string }[] = [];
  let fixed = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const results = await searchAlbums(`${target.artist} ${target.title}`);
      const newUrl = results[0]?.spotifyUrl ?? "";

      if (!newUrl || !newUrl.startsWith("https://open.spotify.com/")) {
        failed++;
        continue;
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!${cSpotify}${target.rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newUrl]] },
      });

      details.push({ no: target.no, title: target.title, artist: target.artist, newUrl });
      fixed++;
    } catch (e) {
      console.error(`Failed to repair row ${target.rowNum} (${target.title}):`, e);
      failed++;
    }

    // Spotify API レートリミット対策
    await sleep(200);
  }

  return NextResponse.json({ total: targets.length, fixed, failed, details });
}
