import { NextResponse } from "next/server";
import { google } from "googleapis";
import { ReleaseMasterAlbum } from "@/lib/types";
import { buildHeaderMap, getCol, SHEET_COL } from "@/lib/sheet-headers";
import { cached, CACHE_KEY, CACHE_TTL } from "@/lib/api-cache";

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

async function fetchAlbums(): Promise<ReleaseMasterAlbum[]> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getAuth() });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",  // 1行目からヘッダー込みで取得（列追加に備え余裕を持たせる）
  });

  const allRows = response.data.values;
  if (!allRows || allRows.length < 2) return [];

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
      genreMemo:  row[col[SHEET_COL.GENRE_MEMO]]  || "",
      country:    row[col[SHEET_COL.COUNTRY]]     || "",
      mjAdoption: row[col[SHEET_COL.MJ_ADOPTION]] || "",
      mjAssign:   row[col[SHEET_COL.MJ_ASSIGN]]   || "",
      mjTrackNo:   row[col[SHEET_COL.MJ_TRACK_NO]] || "",
      mjTrack:     row[col[SHEET_COL.MJ_TRACK]]    || "",
      mjStartTime: row[col[SHEET_COL.START_TIME]]  || "",
      mjText:      row[col[SHEET_COL.MJ_TEXT]]     || "",
      legacyScores: LEGACY_MEMBERS
        .map((name) => ({
          name,
          value: row[col[name] ?? -1] || "",
        }))
        .filter((s) => s.value !== ""),
      spotifyUrl: row[col[SHEET_COL.SPOTIFY_URL]] || "",
      coverUrl:   row[col[SHEET_COL.COVER_URL]]   || "",
    }));

  // タイトル+アーティストが同じ行は先頭（シート上で上にある行）を残して重複除去
  const seen = new Set<string>();
  return albums.filter((a) => {
    const key = `${a.title.trim().toLowerCase()}::${a.artist.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET() {
  try {
    const albums = await cached(CACHE_KEY.RELEASE_MASTER, CACHE_TTL.RELEASE_MASTER, fetchAlbums);
    return NextResponse.json(albums);
  } catch (error) {
    console.error("Failed to get Release Master albums:", error);
    return NextResponse.json({ error: "アルバム一覧の取得に失敗しました" }, { status: 500 });
  }
}
