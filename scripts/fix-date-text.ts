/**
 * Release Master の Date列（B列）に文字列として入ってしまった日付
 * （シート上で先頭に ' が付いて見える）を、本物の日付値に直すスクリプト。
 *
 * 原因: app/api/sheets/add-album/route.ts が日付セルを valueInputOption: "RAW" で
 * 書き込んでいたため、"YYYY/MM/DD" が文字列として入っていた（2026-09-12に USER_ENTERED へ修正）。
 * このスクリプトはその修正より前に書き込まれた既存行を直す。
 *
 * 判定: セルの userEnteredValue が stringValue（かつ "=" で始まらない = 数式ではない）
 * 対象のみ。すでに数値（日付）になっている行や数式が入っている行はスキップするため、
 * 何度実行しても安全（冪等）。
 *
 * 実行方法:
 *   npx tsx scripts/fix-date-text.ts           # dry-run（対象行の表示のみ）
 *   npx tsx scripts/fix-date-text.ts --apply   # 実際に書き込む
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getWriteAuth } from "../lib/release-master";
import { buildHeaderMap, indexToColumnLetter } from "../lib/sheet-headers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");

async function main() {
  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getWriteAuth() });

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!1:1",
  });
  const col = buildHeaderMap(headerRes.data.values?.[0] ?? []);
  const dateColIdx = col["Date"] ?? col["日付"] ?? 1;
  const dateColLetter = indexToColumnLetter(dateColIdx);

  // userEnteredValue で文字列/数式/数値を判別するため、values.get ではなく
  // spreadsheets.get(includeGridData) を使う
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'Release Master'!${dateColLetter}2:${dateColLetter}`],
    includeGridData: true,
    fields: "sheets.data.rowData.values(userEnteredValue,formattedValue)",
  });
  const rowData = meta.data.sheets?.[0]?.data?.[0]?.rowData ?? [];

  const targets: { sheetRow: number; text: string }[] = [];
  rowData.forEach((row, i) => {
    const cell = row.values?.[0];
    const str = cell?.userEnteredValue?.stringValue;
    if (typeof str === "string" && str.trim() && !str.startsWith("=")) {
      targets.push({ sheetRow: i + 2, text: str.trim() });
    }
  });

  console.log(`対象: ${targets.length}行`);
  for (const t of targets) {
    console.log(`  row${t.sheetRow}: "${t.text}"`);
  }

  if (targets.length === 0) {
    console.log("直す行はありません。");
    return;
  }

  if (!APPLY) {
    console.log("\ndry-runのため書き込みは行いません。--apply を付けて再実行してください。");
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: targets.map((t) => ({
        range: `'Release Master'!${dateColLetter}${t.sheetRow}`,
        values: [[t.text]],
      })),
    },
  });

  console.log(`\n${targets.length}行を書き直しました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
