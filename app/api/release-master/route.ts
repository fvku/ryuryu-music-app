import { NextResponse } from "next/server";
import { google } from "googleapis";
import { ReleaseMasterAlbum } from "@/lib/types";
import { buildHeaderMap, getCol, SHEET_COL } from "@/lib/sheet-headers";

export const dynamic = "force-dynamic";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

function getAuth() {
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
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function GET() {
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A1:AD",  // 1行目からヘッダー込みで取得
    });

    const allRows = response.data.values;
    if (!allRows || allRows.length < 2) return NextResponse.json([]);

    const [headerRow, ...dataRows] = allRows;
    const col = buildHeaderMap(headerRow);

    const albums: ReleaseMasterAlbum[] = dataRows
      .filter((row) =>
        row[getCol(col, "NO")] &&
        row[getCol(col, "TITLE")] &&
        row[getCol(col, "ARTIST")]
      )
      .map((row) => ({
        no:         row[getCol(col, "NO")]          || "",
        date:       row[getCol(col, "DATE")]         || "",
        title:      row[getCol(col, "TITLE")]        || "",
        artist:     row[getCol(col, "ARTIST")]       || "",
        genre:      (row[getCol(col, "GENRE")]       || "") as ReleaseMasterAlbum["genre"],
        mjAdoption: row[col[SHEET_COL.MJ_ADOPTION]] || "",
        mjAssign:   row[col[SHEET_COL.MJ_ASSIGN]]   || "",
        mjTrackNo:  row[col[SHEET_COL.MJ_TRACK_NO]] || "",
        mjTrack:    row[col[SHEET_COL.MJ_TRACK]]     || "",
        mjText:     row[col[SHEET_COL.MJ_TEXT]]      || "",
        legacyScores: LEGACY_MEMBERS
          .map((name) => ({
            name,
            value: row[col[name] ?? -1] || "",
          }))
          .filter((s) => s.value !== ""),
        spotifyUrl: row[col[SHEET_COL.SPOTIFY_URL]] || "",
        coverUrl:   row[col[SHEET_COL.COVER_URL]]   || "",
      }));

    return NextResponse.json(albums);
  } catch (error) {
    console.error("Failed to get Release Master albums:", error);
    return NextResponse.json({ error: "アルバム一覧の取得に失敗しました" }, { status: 500 });
  }
}
