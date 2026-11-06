/**
 * Release Master の作品一覧を読む（/api/release-master と通知のアラート計算で共用）。
 */

import "server-only";
import { google } from "googleapis";
import { ReleaseMasterAlbum } from "@/lib/types";
import { buildHeaderMap, getCol, SHEET_COL } from "@/lib/sheet-headers";
import { cached, CACHE_KEY, CACHE_TTL } from "@/lib/api-cache";
import { getGoogleAuth } from "@/lib/google-auth";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

export async function fetchReleaseMasterAlbums(): Promise<ReleaseMasterAlbum[]> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
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
      uid:        (row[col[SHEET_COL.UID]] || "").trim(),
      date:       row[getCol(col, "DATE")]         || "",
      title:      row[getCol(col, "TITLE")]        || "",
      artist:     row[getCol(col, "ARTIST")]       || "",
      genre:      (row[getCol(col, "GENRE")]       || "") as ReleaseMasterAlbum["genre"],
      duration:   row[getCol(col, "TIME")]         || "",
      weekNumber: row[getCol(col, "WEEK_NUMBER")]  || "",
      genreMemo:  row[col[SHEET_COL.GENRE_MEMO]]  || "",
      playlistMemo: row[col[SHEET_COL.PLAYLIST]] || "",
      country:    row[col[SHEET_COL.COUNTRY]]     || "",
      weekAdoption: row[col[SHEET_COL.WEEK_ADOPTION]] || "",
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
      coverUrlLarge: row[col[SHEET_COL.COVER_URL_LARGE]] || "",
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

/** キャッシュ経由で読む（TTLは CACHE_TTL.RELEASE_MASTER） */
export function getReleaseMasterAlbums(): Promise<ReleaseMasterAlbum[]> {
  return cached(CACHE_KEY.RELEASE_MASTER, CACHE_TTL.RELEASE_MASTER, fetchReleaseMasterAlbums);
}
