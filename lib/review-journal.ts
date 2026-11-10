/**
 * アプリが Release Master のレビュー欄へ書いたことを、Apps Script と同じ `_review_edit_log` に残す。
 * Sheets API からの書き込みでは編集トリガーが動かないため、記録しないと「時刻不明の差分」に見えてしまう。
 *
 * 履歴シートはApps Scriptの設置関数が作る。無い（未設置）・見出しが違う場合は何も書かない
 * （見出しの違うシートへ書くと、Apps Script 側の記録を壊すため）。記録の失敗で保存自体は止めない。
 */

import { sheets_v4 } from "googleapis";
import { appJournalRow, JOURNAL_HEADERS, JOURNAL_SHEET } from "@/lib/review-sync";

// 設置済みと確かめられたら、このインスタンスでは覚えておく（未設置は後から設置されうるので覚えない）
let journalReady = false;

async function isJournalReady(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<boolean> {
  if (journalReady) return true;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${JOURNAL_SHEET}!A1:N1` });
    journalReady = JSON.stringify(res.data.values?.[0] ?? []) === JSON.stringify(JOURNAL_HEADERS);
  } catch {
    journalReady = false;
  }
  return journalReady;
}

export async function appendReleaseMasterJournal(
  sheets: sheets_v4.Sheets,
  entries: Parameters<typeof appJournalRow>[0][]
): Promise<boolean> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId || entries.length === 0) return false;
  try {
    if (!(await isJournalReady(sheets, spreadsheetId))) return false;
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${JOURNAL_SHEET}!A:N`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: entries.map(appJournalRow) },
    });
    return true;
  } catch (e) {
    console.error("review journal append failed:", e);
    return false;
  }
}
