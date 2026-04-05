import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ReleaseMasterAlbum } from "@/lib/types";
import { buildHeaderMap, findMissingColumns, getCol, indexToColumnLetter, SHEET_COL } from "@/lib/sheet-headers";

export const dynamic = "force-dynamic";

const LEGACY_MEMBERS = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa"];

function getAuth(write = false) {
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
    scopes: write
      ? ["https://www.googleapis.com/auth/spreadsheets"]
      : ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { no: string } }
) {
  try {
    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth() });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A1:AD",
    });

    const allRows = response.data.values;
    if (!allRows || allRows.length < 2) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const [headerRow, ...dataRows] = allRows;
    const col = buildHeaderMap(headerRow);

    const row = dataRows.find(
      (r) => r[getCol(col, "NO")] === params.no &&
             r[getCol(col, "TITLE")] &&
             r[getCol(col, "ARTIST")]
    );
    if (!row) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }

    const album: ReleaseMasterAlbum = {
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
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
    }

    const body = await request.json();
    const { mjAdoption, mjData } = body;
    if (mjAdoption === undefined && mjData === undefined) {
      return NextResponse.json({ error: "mjAdoption または mjData が必要です" }, { status: 400 });
    }

    const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ error: "RELEASE_MASTER_SPREADSHEET_ID is not set" }, { status: 500 });
    }

    const sheets = google.sheets({ version: "v4", auth: getAuth(true) });

    // ヘッダー行と No. 列を同時取得
    const [headerRes, noColRes] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Release Master'!1:1",
      }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'Release Master'!A2:A",
      }),
    ]);

    const col = buildHeaderMap(headerRes.data.values?.[0] ?? []);

    // 対象行番号を特定
    const noRows = noColRes.data.values ?? [];
    const rowIndex = noRows.findIndex((r) => r[0] === params.no);
    if (rowIndex === -1) {
      return NextResponse.json({ error: "アルバムが見つかりません" }, { status: 404 });
    }
    const sheetRow = rowIndex + 2;

    // ★ 書き込み前に必要列の存在チェック
    const requiredForMjAdoption = mjAdoption !== undefined ? [SHEET_COL.MJ_ADOPTION] : [];
    const requiredForMjData = mjData !== undefined
      ? [SHEET_COL.MJ_TRACK_NO, SHEET_COL.MJ_TRACK, SHEET_COL.MJ_TEXT]
      : [];
    const missing = findMissingColumns(col, [...requiredForMjAdoption, ...requiredForMjData]);

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
      const { trackNo, trackName, mjText } = mjData as {
        trackNo: string;
        trackName: string;
        mjText: string;
      };
      const cTrackNo  = indexToColumnLetter(col[SHEET_COL.MJ_TRACK_NO]);
      const cTrack    = indexToColumnLetter(col[SHEET_COL.MJ_TRACK]);
      const cMjText   = indexToColumnLetter(col[SHEET_COL.MJ_TEXT]);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            { range: `'Release Master'!${cTrackNo}${sheetRow}`,  values: [[trackNo   ?? ""]] },
            { range: `'Release Master'!${cTrack}${sheetRow}`,    values: [[trackName ?? ""]] },
            { range: `'Release Master'!${cMjText}${sheetRow}`,   values: [[mjText    ?? ""]] },
          ],
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update Release Master:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}
