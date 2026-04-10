import { google } from "googleapis";
import { MEMBER_COLUMN_INDEX } from "./members";
import { buildHeaderMap, findMissingColumns, indexToColumnLetter, SHEET_COL } from "./sheet-headers";

export function getWriteAuth() {
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

export async function writeSpotifyDataToSheet(
  updates: { no: string; spotifyUrl: string; coverUrl: string }[]
): Promise<void> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId || updates.length === 0) return;

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

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

  // ★ 書き込み列の存在チェック
  const missing = findMissingColumns(col, [SHEET_COL.SPOTIFY_URL, SHEET_COL.COVER_URL]);
  if (missing.length > 0) {
    throw new Error(`COLUMN_NOT_FOUND: ${missing.join(", ")}`);
  }

  const cSpotify = indexToColumnLetter(col[SHEET_COL.SPOTIFY_URL]);
  const cCover   = indexToColumnLetter(col[SHEET_COL.COVER_URL]);

  const noColumn = noColRes.data.values || [];
  const noToRow: Record<string, number> = {};
  noColumn.forEach((row, i) => {
    if (row[0]) noToRow[row[0]] = i + 2;
  });

  const data = updates.flatMap(({ no, spotifyUrl, coverUrl }) => {
    const rowNum = noToRow[no];
    if (!rowNum) return [];
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
    // TODO: Kaede のメールアドレスが確定したらここに追加し、bulk import を実行する
    // "Kaede": "kaede@actual-email.com",
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

export async function writeScoreToReleaseMaster(
  albumTitle: string,
  artistName: string,
  memberName: string,
  score: number,
  comment: string
): Promise<void> {
  if (!albumTitle || !artistName) return;

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

  // 対象行を探す
  const rows = titleColRes.data.values || [];
  let rowNum: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || "").trim() === albumTitle.trim() && (rows[i][1] || "").trim() === artistName.trim()) {
      rowNum = i + 2;
      break;
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
