import { google } from "googleapis";
import { generatorHandler } from "@/lib/generator/http";
import { importDocument, importWeeklyDocument, parseImportPeriod, parseWeeklyImportPeriod, type MonthlyGeneratorSeries } from "@/lib/generator/source";
import { getGoogleAuth } from "@/lib/google-auth";
import { buildHeaderMap, getCol, SHEET_COL } from "@/lib/sheet-headers";
import type { ReleaseMasterAlbum } from "@/lib/types";
import { GeneratorError } from "@/lib/generator/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return generatorHandler(request, async () => {
    const { searchParams } = new URL(request.url), series = searchParams.get("series");
    let period: string;
    if (series === "weekly") {
      period = searchParams.get("week") || "";
      if (searchParams.size !== 2) throw new GeneratorError("INVALID_INPUT", 400, "企画と対象週を確認してください。");
      parseWeeklyImportPeriod(period);
    } else if (series === "monthly" || series === "japan") {
      period = searchParams.get("month") || "";
      if (searchParams.size !== 2) throw new GeneratorError("INVALID_INPUT", 400, "企画と対象月を確認してください。");
      parseImportPeriod(period);
    } else {
      throw new GeneratorError("INVALID_INPUT", 400, "企画と対象期間を確認してください。");
    }
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) throw new GeneratorError("SOURCE_NOT_CONFIGURED", 503, "Release Masterが設定されていません。");
    const response = await google.sheets({ version: "v4", auth: getGoogleAuth() }).spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
    const [headers, ...rows] = response.data.values || [];
    if (!headers) throw new GeneratorError("SOURCE_UNAVAILABLE", 503, "Release Masterを読み込めません。");
    const col = buildHeaderMap(headers), value = (row: unknown[], name: string) => String(row[col[name] ?? -1] || "");
    const albums = rows.filter(row => row[getCol(col, "NO")] && row[getCol(col, "TITLE")] && row[getCol(col, "ARTIST")]).map(row => ({
      no: String(row[getCol(col, "NO")] || ""), uid: value(row, SHEET_COL.UID).trim(), date: String(row[getCol(col, "DATE")] || ""),
      title: String(row[getCol(col, "TITLE")] || ""), artist: String(row[getCol(col, "ARTIST")] || ""), genre: String(row[getCol(col, "GENRE")] || "") as ReleaseMasterAlbum["genre"],
      duration: String(row[getCol(col, "TIME")] || ""),
      weekNumber: value(row, SHEET_COL.WEEK_NUMBER),
      genreMemo: value(row, SHEET_COL.GENRE_MEMO), country: value(row, SHEET_COL.COUNTRY), weekAdoption: value(row, SHEET_COL.WEEK_ADOPTION),
      mjAdoption: value(row, SHEET_COL.MJ_ADOPTION),
      mjAssign: value(row, SHEET_COL.MJ_ASSIGN), mjTrackNo: value(row, SHEET_COL.MJ_TRACK_NO), mjTrack: value(row, SHEET_COL.MJ_TRACK),
      mjStartTime: value(row, SHEET_COL.START_TIME), mjText: value(row, SHEET_COL.MJ_TEXT), legacyScores: [],
      spotifyUrl: value(row, SHEET_COL.SPOTIFY_URL), coverUrl: value(row, SHEET_COL.COVER_URL),
      coverUrlLarge: value(row, SHEET_COL.COVER_URL_LARGE),
    }));
    return series === "weekly" ? importWeeklyDocument(albums, period) : importDocument(albums, series as MonthlyGeneratorSeries, period);
  });
}
