/**
 * Release Master の全行に安定ID（UID）を採番する。
 *
 * - UID列（ヘッダー "UID"）がなければヘッダー行の右端に新設する
 * - タイトルまたはアーティストがある行のうち、UIDが空の行にのみ採番する
 * - 既存のUIDは変更しない（冪等）
 *
 * 実行方法:
 *   npx tsx scripts/assign-uids.ts           # dry-run（確認のみ）
 *   npx tsx scripts/assign-uids.ts --apply   # 書き込み
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { generateAlbumUid } from "../lib/uid";
import { buildHeaderMap, indexToColumnLetter, SHEET_COL } from "../lib/sheet-headers";
import { getGoogleAuth } from "../lib/google-auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");

async function main() {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });

  console.log("シートを読み込み中...");
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!A1:AZ",
  });

  const allRows = resp.data.values ?? [];
  if (allRows.length < 2) throw new Error("データが見つかりません");

  const [headerRow, ...dataRows] = allRows;
  const col = buildHeaderMap(headerRow);

  const titleIdx  = col["Title"]  ?? col["アルバム名"]  ?? 2;
  const artistIdx = col["Artist"] ?? col["アーティスト"] ?? 3;

  // UID列: 既存ならそのインデックス、なければ「全行でデータが一切ない」最初の列に新設
  // （ヘッダーなしのはみ出しセルを誤ってUIDとして採用しないため）
  let uidIdx = col[SHEET_COL.UID];
  const needHeader = uidIdx === undefined;
  if (needHeader) {
    const maxRowLen = Math.max(headerRow.length, ...dataRows.map((r) => r.length));
    uidIdx = maxRowLen;
    console.log(`UID列が存在しないため ${indexToColumnLetter(uidIdx)} 列に新設します（既存データのない最初の列）`);
  } else {
    console.log(`UID列: ${indexToColumnLetter(uidIdx)} 列（既存）`);
  }
  const cUid = indexToColumnLetter(uidIdx);

  // 既存UIDの重複チェック用セット
  const usedUids = new Set<string>();
  for (const row of dataRows) {
    const u = (row[uidIdx] ?? "").trim();
    if (u) {
      if (usedUids.has(u)) throw new Error(`既存UIDに重複があります: ${u}（手動確認が必要）`);
      usedUids.add(u);
    }
  }

  // 採番対象: タイトルまたはアーティストがあり、UIDが空の行
  let assigned = 0;
  let skippedHasUid = 0;
  let skippedEmpty = 0;
  const columnValues: string[][] = dataRows.map((row) => {
    const existing = (row[uidIdx!] ?? "").trim();
    if (existing) { skippedHasUid++; return [existing]; }
    const hasContent = (row[titleIdx] ?? "").trim() || (row[artistIdx] ?? "").trim();
    if (!hasContent) { skippedEmpty++; return [""]; }
    let uid = generateAlbumUid();
    while (usedUids.has(uid)) uid = generateAlbumUid();
    usedUids.add(uid);
    assigned++;
    return [uid];
  });

  console.log(`\n対象データ行: ${dataRows.length}`);
  console.log(`  新規採番:   ${assigned}`);
  console.log(`  採番済み:   ${skippedHasUid}`);
  console.log(`  空行スキップ: ${skippedEmpty}`);

  if (!APPLY) {
    console.log("\n(dry-run) --apply を付けて実行すると書き込みます");
    return;
  }

  if (needHeader) {
    // グリッドの列数が足りない場合は先に拡張する
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = meta.data.sheets?.find((s) => s.properties?.title === "Release Master");
    const sheetId = sheet?.properties?.sheetId;
    const colCount = sheet?.properties?.gridProperties?.columnCount ?? 0;
    if (sheetId !== undefined && uidIdx >= colCount) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: uidIdx - colCount + 1 } }],
        },
      });
      console.log(`グリッドを ${colCount} 列 → ${uidIdx + 1} 列に拡張しました`);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Release Master'!${cUid}1`,
      valueInputOption: "RAW",
      requestBody: { values: [[SHEET_COL.UID]] },
    });
    console.log(`ヘッダー "${SHEET_COL.UID}" を ${cUid}1 に書き込みました`);
  }

  // UID列全体を1回のupdateで書き込む（既存UIDはそのまま保持される値を書く）
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Release Master'!${cUid}2:${cUid}${dataRows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: columnValues },
  });

  console.log(`\n完了: ${assigned} 行に採番しました`);
}

main().catch((e) => { console.error(e); process.exit(1); });
