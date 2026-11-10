import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { guardMember } from "@/lib/member-auth";
import { isAuthorized } from "@/lib/api-token";
import { corsJson, corsPreflight } from "@/lib/api-cors";
import { ReleaseMasterAlbum } from "@/lib/types";
import { buildHeaderMap, findMissingColumns, getCol, getWriteCol, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { getGoogleAuth } from "@/lib/google-auth";
import { findMjConflicts, MjValues } from "@/lib/mj-concurrency";

export const dynamic = "force-dynamic";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

/** GET のプリフライト。Allow-Methods に PATCH は載せないので書き込みは従来どおり弾かれる */
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return corsJson({ error: "認証が必要です" }, { status: 401 });
  }
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return corsJson({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
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
      return corsJson({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const [headerRow, ...dataRows] = allRows;
    const col = buildHeaderMap(headerRow);

    if (!uidParam && (!titleParam || !artistParam)) {
      return corsJson({ error: "uid または title+artist が必要です" }, { status: 400 });
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
      return corsJson({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const album: ReleaseMasterAlbum = {
      no:         row[getCol(col, "NO")]          || "",
      uid:        (uidIdx !== undefined ? row[uidIdx] || "" : "").trim(),
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
      mjTrackNo:   row[col[SHEET_COL.MJ_TRACK_NO]]  || "",
      mjTrack:     row[col[SHEET_COL.MJ_TRACK]]     || "",
      mjStartTime: row[col[SHEET_COL.START_TIME]]   || "",
      mjText:      row[col[SHEET_COL.MJ_TEXT]]      || "",
      legacyScores: LEGACY_MEMBERS
        .map((name) => ({ name, value: row[col[name] ?? -1] || "" }))
        .filter((s) => s.value !== ""),
      spotifyUrl: row[col[SHEET_COL.SPOTIFY_URL]] || "",
      coverUrl:   row[col[SHEET_COL.COVER_URL]]   || "",
      coverUrlLarge: row[col[SHEET_COL.COVER_URL_LARGE]] || "",
    };

    return corsJson(album);
  } catch (error) {
    console.error("Failed to get album from Release Master:", error);
    return corsJson({ error: "アルバムの取得に失敗しました" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const gate = await guardMember(request);
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const { mjAdoption, mjData, mjAssign, albumMeta, uid, title, artist, base } = body;
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
    // mjData は送られた項目だけを書く（変えていない項目を古い値で戻さないため）
    const mjFieldCols: Record<string, string> = {
      trackNo: SHEET_COL.MJ_TRACK_NO, trackName: SHEET_COL.MJ_TRACK, startTime: SHEET_COL.START_TIME, mjText: SHEET_COL.MJ_TEXT,
    };
    const mjDataObj = (mjData ?? {}) as Record<string, string | undefined>;
    const requiredForMjAdoption = mjAdoption !== undefined ? [SHEET_COL.MJ_ADOPTION] : [];
    const requiredForMjData     = Object.keys(mjFieldCols).filter((k) => mjDataObj[k] !== undefined).map((k) => mjFieldCols[k]);
    const requiredForMjAssign   = mjAssign   !== undefined ? [SHEET_COL.MJ_ASSIGN] : [];
    const missing = findMissingColumns(col, [...requiredForMjAdoption, ...requiredForMjData, ...requiredForMjAssign]);
    // albumMeta列はオプション（見つからなければスキップ）

    if (missing.length > 0) {
      return NextResponse.json(
        { error: "列が見つかりません", errorCode: "COLUMN_NOT_FOUND", missing },
        { status: 422 }
      );
    }

    // 開いた時点の値（base）が送られていれば、他の人がその後に同じ項目を書き換えていないか確かめる
    const row = dataRows[rowIndex];
    const cellOf = (name: string) => {
      const idx = getWriteCol(col, name);
      return idx >= 0 ? String(row[idx] ?? "") : "";
    };
    const metaObj = (albumMeta ?? {}) as { genreMemo?: string; country?: string };
    const requested: MjValues = {
      mjTrackNo: mjDataObj.trackNo, mjTrack: mjDataObj.trackName, mjStartTime: mjDataObj.startTime, mjText: mjDataObj.mjText,
      genreMemo: metaObj.genreMemo, country: metaObj.country,
    };
    if (base && typeof base === "object") {
      const current: MjValues = {
        mjTrackNo: cellOf(SHEET_COL.MJ_TRACK_NO), mjTrack: cellOf(SHEET_COL.MJ_TRACK),
        mjStartTime: cellOf(SHEET_COL.START_TIME), mjText: cellOf(SHEET_COL.MJ_TEXT),
        genreMemo: cellOf(SHEET_COL.GENRE_MEMO), country: cellOf(SHEET_COL.COUNTRY),
      };
      const conflicts = findMjConflicts(requested, base as MjValues, current);
      if (conflicts.length > 0) {
        return NextResponse.json(
          { error: "他の人が先に保存した内容があります", errorCode: "CONFLICT", conflicts, current },
          { status: 409 }
        );
      }
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
      const data = Object.keys(mjFieldCols)
        .filter((k) => mjDataObj[k] !== undefined)
        .map((k) => ({
          range: `'Release Master'!${indexToColumnLetter(col[mjFieldCols[k]])}${sheetRow}`,
          values: [[mjDataObj[k] ?? ""]],
        }));
      if (data.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "RAW", data },
        });
      }
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
