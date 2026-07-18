import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { ReleaseMasterAlbum } from "@/lib/types";
import { buildHeaderMap, findMissingColumns, getCol, getWriteCol, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { getGoogleAuth } from "@/lib/google-auth";

export const dynamic = "force-dynamic";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

export async function GET(
  request: NextRequest,
  { params }: { params: { no: string } }
) {
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const uidParam = searchParams.get("uid");
    const titleParam = searchParams.get("title");
    const artistParam = searchParams.get("artist");

    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A1:AZ",
    });

    const allRows = response.data.values;
    if (!allRows || allRows.length < 2) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const [headerRow, ...dataRows] = allRows;
    const col = buildHeaderMap(headerRow);

    if (!uidParam && (!titleParam || !artistParam)) {
      return NextResponse.json({ error: "uid または title+artist が必要です" }, { status: 400 });
    }
    // UID優先で行を特定し、見つからなければ title+artist にフォールバック
    const uidIdx = col[SHEET_COL.UID];
    let row = uidParam && uidIdx !== undefined
      ? dataRows.find((r) => (r[uidIdx] || "").trim() === uidParam)
      : undefined;
    if (!row && titleParam && artistParam) {
      row = dataRows.find(
        (r) => r[getCol(col, "TITLE")] === titleParam && r[getCol(col, "ARTIST")] === artistParam
      );
    }
    if (!row) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const album: ReleaseMasterAlbum = {
      no:         row[getCol(col, "NO")]          || "",
      uid:        (uidIdx !== undefined ? row[uidIdx] || "" : "").trim(),
      date:       row[getCol(col, "DATE")]         || "",
      title:      row[getCol(col, "TITLE")]        || "",
      artist:     row[getCol(col, "ARTIST")]       || "",
      genre:      (row[getCol(col, "GENRE")]       || "") as ReleaseMasterAlbum["genre"],
      genreMemo:  row[col[SHEET_COL.GENRE_MEMO]]  || "",
      country:    row[col[SHEET_COL.COUNTRY]]     || "",
      mjAdoption: row[col[SHEET_COL.MJ_ADOPTION]] || "",
      mjAssign:   row[col[SHEET_COL.MJ_ASSIGN]]   || "",
      mjTrackNo:   row[col[SHEET_COL.MJ_TRACK_NO]]  || "",
      mjTrack:     row[col[SHEET_COL.MJ_TRACK]]     || "",
      mjStartTime: row[col[SHEET_COL.START_TIME]]   || "",
      mjText:      row[col[SHEET_COL.MJ_TEXT]]      || "",
      legacyScores: LEGACY_MEMBERS
        .map((name) => ({ name, value: row[col[name] ?? -1] || "" }))
        .filter((s) => s.value !== ""),
      spotifyUrl: row[col[SHEET_COL.SPOTIFY_URL]] || "",
      coverUrl:   row[col[SHEET_COL.COVER_URL]]   || "",
    };

    return NextResponse.json(album);
  } catch (error) {
    console.error("Failed to get album from Release Master:", error);
    return NextResponse.json({ error: "アルバムの取得に失敗しました" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { no: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const body = await request.json();
    const { mjAdoption, mjData, mjAssign, albumMeta, uid, title, artist } = body;
    if (mjAdoption === undefined && mjData === undefined && mjAssign === undefined && albumMeta === undefined) {
      return NextResponse.json({ error: "mjAdoption, mjData, mjAssign, または albumMeta が必要です" }, { status: 400 });
    }
    if (!uid && (!title || !artist)) {
      return NextResponse.json({ error: "uid または title+artist が必要です" }, { status: 400 });
    }

    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

    // ヘッダー行+全データを取得してtitle+artistで行を特定
    const fullRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A1:AZ",
    });
    const allRows = fullRes.data.values ?? [];
    if (allRows.length < 2) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }
    const [headerRowData, ...dataRows] = allRows;
    const col = buildHeaderMap(headerRowData);

    // UID優先で行を特定し、見つからなければ title+artist にフォールバック
    const uidIdx = col[SHEET_COL.UID];
    let rowIndex = -1;
    if (uid && uidIdx !== undefined) {
      rowIndex = dataRows.findIndex((r) => (r[uidIdx] || "").trim() === uid);
    }
    if (rowIndex === -1 && title && artist) {
      rowIndex = dataRows.findIndex(
        (r) => r[getCol(col, "TITLE")] === title && r[getCol(col, "ARTIST")] === artist
      );
    }
    if (rowIndex === -1) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }
    const sheetRow = rowIndex + 2;

    // ★ 書き込み前に必要列の存在チェック
    const requiredForMjAdoption = mjAdoption !== undefined ? [SHEET_COL.MJ_ADOPTION] : [];
    const requiredForMjData     = mjData     !== undefined ? [SHEET_COL.MJ_TRACK_NO, SHEET_COL.MJ_TRACK, SHEET_COL.START_TIME, SHEET_COL.MJ_TEXT] : [];
    const requiredForMjAssign   = mjAssign   !== undefined ? [SHEET_COL.MJ_ASSIGN] : [];
    const missing = findMissingColumns(col, [...requiredForMjAdoption, ...requiredForMjData, ...requiredForMjAssign]);
    // albumMeta列はオプション（見つからなければスキップ）

    if (missing.length > 0) {
      return NextResponse.json(
        { error: "列が見つかりません", errorCode: "COLUMN_NOT_FOUND", missing },
        { status: 422 }
      );
    }

    if (mjAdoption !== undefined) {
      const colLetter = indexToColumnLetter(col[SHEET_COL.MJ_ADOPTION]);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!${colLetter}${sheetRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [[mjAdoption]] },
      });
    }

    if (mjData !== undefined) {
      const { trackNo, trackName, startTime, mjText } = mjData as {
        trackNo: string;
        trackName: string;
        startTime: string;
        mjText: string;
      };
      const cTrackNo    = indexToColumnLetter(col[SHEET_COL.MJ_TRACK_NO]);
      const cTrack      = indexToColumnLetter(col[SHEET_COL.MJ_TRACK]);
      const cStartTime  = indexToColumnLetter(col[SHEET_COL.START_TIME]);
      const cMjText     = indexToColumnLetter(col[SHEET_COL.MJ_TEXT]);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `'Release Master'!${cTrackNo}${sheetRow}`,   values: [[trackNo    ?? ""]] },
            { range: `'Release Master'!${cTrack}${sheetRow}`,     values: [[trackName  ?? ""]] },
            { range: `'Release Master'!${cStartTime}${sheetRow}`, values: [[startTime  ?? ""]] },
            { range: `'Release Master'!${cMjText}${sheetRow}`,    values: [[mjText     ?? ""]] },
          ],
        },
      });
    }

    if (mjAssign !== undefined) {
      const colLetter = indexToColumnLetter(col[SHEET_COL.MJ_ASSIGN]);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Release Master'!${colLetter}${sheetRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [[mjAssign]] },
      });
    }

    if (albumMeta !== undefined) {
      const { genreMemo, country } = albumMeta as { genreMemo?: string; country?: string };
      const metaData: { range: string; values: string[][] }[] = [];
      const genreMemoIdx = getWriteCol(col, SHEET_COL.GENRE_MEMO);
      const countryIdx   = getWriteCol(col, SHEET_COL.COUNTRY);
      if (genreMemo !== undefined && genreMemoIdx >= 0) {
        metaData.push({ range: `'Release Master'!${indexToColumnLetter(genreMemoIdx)}${sheetRow}`, values: [[genreMemo]] });
      }
      if (country !== undefined && countryIdx >= 0) {
        metaData.push({ range: `'Release Master'!${indexToColumnLetter(countryIdx)}${sheetRow}`, values: [[country]] });
      }
      if (metaData.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "RAW", data: metaData },
        });
      }
    }

    invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update Release Master:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
