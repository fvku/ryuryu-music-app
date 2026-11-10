import { google } from "googleapis";
import { buildHeaderMap, findMissingColumns, indexToColumnLetter, SHEET_COL } from "./sheet-headers";
import { getGoogleAuth } from "./google-auth";
import { invalidateCache, CACHE_KEY } from "./api-cache";
import { SHORT_NAME_TO_EMAIL } from "@/lib/members";
import { formatReviewCell } from "@/lib/review-sync";
import { appendReleaseMasterJournal } from "@/lib/review-journal";

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

  // 空欄のセルだけ埋める。手で入れたURL（Bandcamp等）や修正済みの値は上書きしない
  const data = updates.flatMap(({ title, artist, spotifyUrl, coverUrl }) => {
    const rowIndex = dataRows.findIndex(
      (r) => r[col[SHEET_COL.TITLE]] === title && r[col[SHEET_COL.ARTIST]] === artist
    );
    if (rowIndex === -1) return [];
    const row = dataRows[rowIndex];
    const rowNum = rowIndex + 2;
    const cells: { range: string; values: string[][] }[] = [];
    if (spotifyUrl && !row[col[SHEET_COL.SPOTIFY_URL]]) {
      cells.push({ range: `'Release Master'!${cSpotify}${rowNum}`, values: [[spotifyUrl]] });
    }
    if (coverUrl && !row[col[SHEET_COL.COVER_URL]]) {
      cells.push({ range: `'Release Master'!${cCover}${rowNum}`, values: [[coverUrl]] });
    }
    return cells;
  });

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
  invalidateCache(CACHE_KEY.RELEASE_MASTER);
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

  const MEMBER_EMAIL = SHORT_NAME_TO_EMAIL;

  return dataRows
    .filter((row) => row[col["No."] ?? 0] && row[col["アルバム名"] ?? 2] && row[col["アーティスト"] ?? 3])
    .map((row) => {
      const memberScores: Record<string, string> = {};
      for (const [memberName, email] of Object.entries(MEMBER_EMAIL)) {
        // 列位置ではなくヘッダー名だけで解決する。
        // 以前は固定インデックスにフォールバックしていたが、列を移動すると
        // 隣のメンバーの列を読んでしまうため廃止した（2026-09-11）。
        const idx = col[memberName] ?? -1;
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
 * アプリのレビューを Release Master のメンバー列へ書き、`_review_edit_log` にアプリの書き込みとして残す。
 * - スコアなしはコメントだけを書く（空ならセルを空にする）。ただし元々空のセルにスコアなしのレビューは書かない
 *   （コメントだけの投稿は Release Master に書かない従来の仕様）
 * - recordedAt にはアプリ側の submittedAt を渡す（同期で「同じ時刻・同じ内容」として一致させるため）
 */
export async function writeScoreToReleaseMaster(
  albumTitle: string,
  artistName: string,
  memberName: string,
  score: number | null,
  comment: string,
  albumUid?: string,
  journal?: { memberEmail: string; operationId: string; recordedAt: string }
): Promise<void> {
  if (!albumUid && (!albumTitle || !artistName)) return;

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) return;

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  // ヘッダー行とNo.〜アーティスト列を同時取得
  const [headerRes, titleColRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!1:1",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Release Master'!A2:D",
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
  const titleRows = titleColRes.data.values || [];
  if (rowNum === null) {
    for (let i = 0; i < titleRows.length; i++) {
      if ((titleRows[i][2] || "").trim() === albumTitle.trim() && (titleRows[i][3] || "").trim() === artistName.trim()) {
        rowNum = i + 2;
        break;
      }
    }
  }
  if (rowNum === null) return;

  const colIdx = col[memberName];
  if (colIdx === undefined) throw new Error(`COLUMN_NOT_FOUND: ${memberName}`);
  const cellA1 = `${indexToColumnLetter(colIdx)}${rowNum}`;
  const cellValue = formatReviewCell(score, comment);

  const prevRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'Release Master'!${cellA1}` });
  const previous = String(prevRes.data.values?.[0]?.[0] ?? "");
  if (score === null && previous.trim() === "") return;
  if (previous.trim() === cellValue) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Release Master'!${cellA1}`,
    valueInputOption: "RAW",
    requestBody: { values: [[cellValue]] },
  });

  if (journal) {
    const row = titleRows[rowNum - 2] ?? [];
    await appendReleaseMasterJournal(sheets, [{
      operationId: journal.operationId,
      recordedAt: journal.recordedAt,
      albumUid: albumUid ?? "",
      memberEmail: journal.memberEmail,
      value: cellValue,
      previous,
      cellA1,
      albumNo: (row[0] ?? "").trim(),
      albumTitle: (row[2] ?? albumTitle).trim(),
      artistName: (row[3] ?? artistName).trim(),
    }]);
  }
}

/**
 * 誤って登録された行の内容を全列クリアする（行そのものは削除しない。後続行がズレるのを防ぐため）。
 * No./Body/# など数式が入っている列は、値ではなく数式そのものを消してしまうため対象から除外する
 * （その行の実際の内容を数式レンダリングで取得し、"=" で始まるセルをスキップして判定）。
 * MISMATCH手動解消UIの「候補に正解がない」ケースで使う。
 */
export async function clearReleaseMasterRow(rowNum: number): Promise<void> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!1:1" });
  const headerLen = (headerRes.data.values?.[0] ?? []).length;
  if (headerLen === 0) return;

  const lastCol = indexToColumnLetter(headerLen - 1);
  const rowRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Release Master'!A${rowNum}:${lastCol}${rowNum}`,
    valueRenderOption: "FORMULA",
  });
  const rowValues = rowRes.data.values?.[0] ?? [];

  const ranges: string[] = [];
  for (let idx = 0; idx < headerLen; idx++) {
    const cell = rowValues[idx];
    if (typeof cell === "string" && cell.startsWith("=")) continue; // 数式列は保持
    ranges.push(`'Release Master'!${indexToColumnLetter(idx)}${rowNum}`);
  }
  if (ranges.length === 0) return;
  await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges } });
}
