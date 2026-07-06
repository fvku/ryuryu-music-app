/**
 * scoresシートのスコアを Release Master のメンバー列に書き戻すコアロジック。
 * scripts/sync-scores-to-rm.ts（CLI）と app/api/admin/sync-scores-to-rm（管理画面）の共通実装。
 *
 * - 同一アルバム×同一メンバーは最新の submittedAt のみ使用
 * - メンバー列が空の場合のみ書き込む（force 指定で上書き）
 */

import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";
import { indexToColumnLetter } from "@/lib/sheet-headers";
import { EMAIL_TO_SHORT_NAME, LEGACY_NAME_TO_EMAIL } from "@/lib/members";

function normalizeEmail(memberName: string): string | null {
  const lower = (memberName ?? "").toLowerCase().trim();
  if (lower in EMAIL_TO_SHORT_NAME) return lower;
  return LEGACY_NAME_TO_EMAIL[lower] ?? null;
}

export interface SyncScoresToRmOptions {
  /** 既存値も上書きする */
  force?: boolean;
  log?: (msg: string) => void;
}

export interface SyncScoresToRmResult {
  written: number;
  notFound: number;
  skipped: number;
  /** RMに行が見つからなかったアルバム（"title / artist (member)"） */
  notFoundList: string[];
}

export async function syncScoresToRm(options: SyncScoresToRmOptions = {}): Promise<SyncScoresToRmResult> {
  const { force = false, log = () => {} } = options;

  const appSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const rmSpreadsheetId  = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!appSpreadsheetId || !rmSpreadsheetId) throw new Error("環境変数が設定されていません");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  const [scoresRes, rmRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: appSpreadsheetId, range: "scores!A2:G" }),
    sheets.spreadsheets.values.get({ spreadsheetId: rmSpreadsheetId, range: "'Release Master'!A1:AZ" }),
  ]);

  const scoreRows = scoresRes.data.values ?? [];
  const allRows   = rmRes.data.values ?? [];
  if (allRows.length < 2) throw new Error("Release Masterにデータがありません");

  log(`scores シート: ${scoreRows.length} 行`);

  // 同一アルバム×同一メンバーは最新 submittedAt のみ残す
  type ScoreEntry = { score: string; comment: string; submittedAt: string };
  const latestMap = new Map<string, ScoreEntry>();
  for (const row of scoreRows) {
    const memberName  = (row[1] ?? "").trim();
    const score       = (row[2] ?? "").trim();
    const comment     = (row[3] ?? "").trim();
    const submittedAt = (row[4] ?? "").trim();
    const albumTitle  = (row[5] ?? "").trim();
    const artistName  = (row[6] ?? "").trim();
    if (!albumTitle || !artistName || !score) continue;
    const email = normalizeEmail(memberName);
    if (!email) continue;
    const key = `${albumTitle}::${artistName}::${email}`;
    const existing = latestMap.get(key);
    if (!existing || submittedAt > existing.submittedAt) {
      latestMap.set(key, { score, comment, submittedAt });
    }
  }
  log(`重複除去後: ${latestMap.size} エントリ`);

  // Release Master ヘッダーとアルバム行マップを構築
  const [headerRow, ...dataRows] = allRows;
  const colMap: Record<string, number> = {};
  headerRow.forEach((h: string, i: number) => { if (h) colMap[h.trim()] = i; });

  const titleIdx  = colMap["Title"]  ?? colMap["アルバム名"]   ?? 2;
  const artistIdx = colMap["Artist"] ?? colMap["アーティスト"] ?? 3;

  const rmRowMap = new Map<string, { rowNum: number; row: string[] }>();
  for (let i = 0; i < dataRows.length; i++) {
    const t = (dataRows[i][titleIdx]  ?? "").trim();
    const a = (dataRows[i][artistIdx] ?? "").trim();
    if (t && a) rmRowMap.set(`${t}::${a}`, { rowNum: i + 2, row: dataRows[i] });
  }

  // 書き込むセルを収集
  const toWrite: { range: string; values: string[][]; label: string }[] = [];
  const result: SyncScoresToRmResult = { written: 0, notFound: 0, skipped: 0, notFoundList: [] };

  for (const [key, entry] of Array.from(latestMap.entries())) {
    const [albumTitle, artistName, email] = key.split("::");
    const colName = EMAIL_TO_SHORT_NAME[email];
    if (!colName) continue;

    const colIdx = colMap[colName];
    if (colIdx === undefined) { log(`列が見つかりません: ${colName}`); continue; }

    const rmEntry = rmRowMap.get(`${albumTitle}::${artistName}`);
    if (!rmEntry) {
      result.notFound++;
      result.notFoundList.push(`${albumTitle} / ${artistName} (${colName})`);
      continue;
    }

    const existingVal = (rmEntry.row[colIdx] ?? "").trim();
    if (existingVal && !force) { result.skipped++; continue; }

    const cellValue = entry.comment ? `${entry.score} ${entry.comment}` : entry.score;
    toWrite.push({
      range: `'Release Master'!${indexToColumnLetter(colIdx)}${rmEntry.rowNum}`,
      values: [[cellValue]],
      label: `[${colName}] ${albumTitle} / ${artistName} = ${cellValue}`,
    });
  }

  log(`書き込み対象: ${toWrite.length} セル${force ? " (--force: 上書きあり)" : " (空セルのみ)"}`);

  if (toWrite.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: rmSpreadsheetId,
      requestBody: { valueInputOption: "RAW", data: toWrite.map(({ range, values }) => ({ range, values })) },
    });
    toWrite.forEach((w) => log(`  ✓ ${w.label}`));
    result.written = toWrite.length;
  }

  return result;
}
