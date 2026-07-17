import { google } from "googleapis";
import { MEMBER_COLUMN_INDEX } from "./members";
import { buildHeaderMap, findMissingColumns, indexToColumnLetter, SHEET_COL } from "./sheet-headers";
import { getGoogleAuth } from "./google-auth";
import { generateAlbumUid } from "./uid";

export function getWriteAuth() {
  return getGoogleAuth(true);
}

export async function writeSpotifyDataToSheet(
  updates: { title: string; artist: string; spotifyUrl: string; coverUrl: string }[]
): Promise<void> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId || updates.length === 0) return;

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  // ヘッダー行+全データを取得してtitle+artistで行を特定
  const fullRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",
  });

  const allRows = fullRes.data.values ?? [];
  if (allRows.length < 2) return;
  const [headerRowData, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRowData);

  // ★ 書き込み列の存在チェック
  const missing = findMissingColumns(col, [SHEET_COL.SPOTIFY_URL, SHEET_COL.COVER_URL]);
  if (missing.length > 0) {
    throw new Error(`COLUMN_NOT_FOUND: ${missing.join(", ")}`);
  }

  const cSpotify = indexToColumnLetter(col[SHEET_COL.SPOTIFY_URL]);
  const cCover   = indexToColumnLetter(col[SHEET_COL.COVER_URL]);

  const data = updates.flatMap(({ title, artist, spotifyUrl, coverUrl }) => {
    const rowIndex = dataRows.findIndex(
      (r) => r[col[SHEET_COL.TITLE]] === title && r[col[SHEET_COL.ARTIST]] === artist
    );
    if (rowIndex === -1) return [];
    const rowNum = rowIndex + 2;
    return [
      { range: `'Release Master'!${cSpotify}${rowNum}`, values: [[spotifyUrl]] },
      { range: `'Release Master'!${cCover}${rowNum}`,   values: [[coverUrl]] },
    ];
  });

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

export interface ReleaseMasterScoreRow {
  albumNo: string;
  albumTitle: string;
  artistName: string;
  memberScores: Record<string, string>; // email → raw cell value ("7.5 comment")
}

export async function getReleaseMasterScoreRows(): Promise<ReleaseMasterScoreRow[]> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) return [];

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",  // ヘッダー込みで取得（列追加に備え余裕を持たせる）
  });

  const allRows = resp.data.values || [];
  if (allRows.length < 2) return [];

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  // メンバー名 → email のマッピング（EMAIL_TO_SHORT_NAMEの逆引き）
  const MEMBER_EMAIL: Record<string, string> = {
    "Kwisoo": "kwisoo1102@gmail.com",
    "Meri":   "akyme68@gmail.com",
    "Kohei":  "kohei.fuku0926@gmail.com",
    "Eddie":  "edwardcannell93@gmail.com",
    "Hanawa": "yoshinorihnw@gmail.com",
    "Kaede": "qururiquiqui@gmail.com",
  };

  return dataRows
    .filter((row) => row[col["No."] ?? 0] && row[col["アルバム名"] ?? 2] && row[col["アーティスト"] ?? 3])
    .map((row) => {
      const memberScores: Record<string, string> = {};
      for (const [memberName, email] of Object.entries(MEMBER_EMAIL)) {
        // ヘッダーで列名検索 → 見つからなければ MEMBER_COLUMN_INDEX をフォールバック
        const idx = col[memberName] ?? MEMBER_COLUMN_INDEX[memberName] ?? -1;
        const val = idx >= 0 ? (row[idx] || "") : "";
        if (val.trim()) memberScores[email] = val.trim();
      }
      return {
        albumNo:    (row[col["No."] ?? 0]          || "").trim(),
        albumTitle: (row[col["アルバム名"] ?? 2]   || "").trim(),
        artistName: (row[col["アーティスト"] ?? 3] || "").trim(),
        memberScores,
      };
    });
}

/**
 * UIDが空の行（タイトルまたはアーティストあり）に安定IDを採番する。
 * 手動でシートに追加された行への追従用（sync cron から呼ばれる）。
 * UID列が存在しない場合は何もしない（scripts/assign-uids.ts で列を作成する）。
 * @returns 採番した行数
 */
export async function assignMissingUids(): Promise<number> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) return 0;

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) return 0;
  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  const uidIdx = col[SHEET_COL.UID];
  if (uidIdx === undefined) return 0;

  const titleIdx  = col["Title"]  ?? col["アルバム名"]  ?? 2;
  const artistIdx = col["Artist"] ?? col["アーティスト"] ?? 3;
  const cUid = indexToColumnLetter(uidIdx);

  const usedUids = new Set<string>(
    dataRows.map((r) => (r[uidIdx] ?? "").trim()).filter(Boolean)
  );

  const data: { range: string; values: string[][] }[] = [];
  dataRows.forEach((row, i) => {
    if ((row[uidIdx] ?? "").trim()) return;
    const hasContent = (row[titleIdx] ?? "").trim() || (row[artistIdx] ?? "").trim();
    if (!hasContent) return;
    let uid = generateAlbumUid();
    while (usedUids.has(uid)) uid = generateAlbumUid();
    usedUids.add(uid);
    data.push({ range: `'Release Master'!${cUid}${i + 2}`, values: [[uid]] });
  });

  if (data.length === 0) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
  return data.length;
}

export async function writeScoreToReleaseMaster(
  albumTitle: string,
  artistName: string,
  memberName: string,
  score: number,
  comment: string,
  albumUid?: string
): Promise<void> {
  if (!albumUid && (!albumTitle || !artistName)) return;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) return;

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  // ヘッダー行とタイトル・アーティスト列を同時取得
  const [headerRes, titleColRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!1:1",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!C2:D",
    }),
  ]);

  const col = buildHeaderMap(headerRes.data.values?.[0] ?? []);

  // ★ 書き込み列の存在チェック（メンバー名がヘッダーに存在するか）
  const missing = findMissingColumns(col, [memberName]);
  if (missing.length > 0) {
    throw new Error(`COLUMN_NOT_FOUND: ${missing.join(", ")}`);
  }

  // 対象行を探す: UID優先（改名直後の投稿も正しい行に届く）、なければtitle+artist
  let rowNum: number | null = null;
  const uidIdx = col[SHEET_COL.UID];
  if (albumUid && uidIdx !== undefined) {
    const cUid = indexToColumnLetter(uidIdx);
    const uidColRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Release Master'!${cUid}2:${cUid}`,
    });
    const uidRows = uidColRes.data.values || [];
    for (let i = 0; i < uidRows.length; i++) {
      if ((uidRows[i][0] || "").trim() === albumUid) {
        rowNum = i + 2;
        break;
      }
    }
  }
  if (rowNum === null) {
    const rows = titleColRes.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i][0] || "").trim() === albumTitle.trim() && (rows[i][1] || "").trim() === artistName.trim()) {
        rowNum = i + 2;
        break;
      }
    }
  }
  if (rowNum === null) return;

  const colIdx = col[memberName];
  if (colIdx === undefined) throw new Error(`COLUMN_NOT_FOUND: ${memberName}`);
  const colLetter = indexToColumnLetter(colIdx);
  const cellValue = comment ? `${score} ${comment}` : `${score}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Release Master'!${colLetter}${rowNum}`,
    valueInputOption: "RAW",
    requestBody: { values: [[cellValue]] },
  });
}
