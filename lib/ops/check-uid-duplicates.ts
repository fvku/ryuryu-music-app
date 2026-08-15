/**
 * Release MasterのUID列に重複がないかをチェックするコアロジック。
 * app/api/admin/uid-duplicates（管理画面の常時アラート）から呼ばれる。
 * 重複があると assignUids() が全体をブロックするため、管理者が気づけるように可視化する。
 */

import { google } from "googleapis";
import { buildHeaderMap, SHEET_COL } from "@/lib/sheet-headers";
import { getGoogleAuth } from "@/lib/google-auth";

export interface UidDuplicateRow {
  row: number;
  no: string;
  title: string;
  artist: string;
}

export interface UidDuplicateGroup {
  uid: string;
  rows: UidDuplicateRow[];
}

export async function checkUidDuplicates(): Promise<UidDuplicateGroup[]> {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(false) });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) return [];

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);
  const uidIdx = col[SHEET_COL.UID];
  if (uidIdx === undefined) return [];

  const noIdx = col["No."] ?? 0;
  const titleIdx = col["Title"] ?? col["アルバム名"] ?? 2;
  const artistIdx = col["Artist"] ?? col["アーティスト"] ?? 3;

  const byUid = new Map<string, UidDuplicateRow[]>();
  dataRows.forEach((row, i) => {
    const uid = (row[uidIdx] ?? "").trim();
    if (!uid) return;
    const entry: UidDuplicateRow = {
      row: i + 2,
      no: (row[noIdx] ?? "").trim(),
      title: (row[titleIdx] ?? "").trim(),
      artist: (row[artistIdx] ?? "").trim(),
    };
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid)!.push(entry);
  });

  return Array.from(byUid.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([uid, rows]) => ({ uid, rows }));
}
