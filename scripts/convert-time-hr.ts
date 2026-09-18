/**
 * Release Master の Time列にある60分以上の値を "1hr 24min" 形式へ書き換える。
 * 例: "24songs, 84min 59sec" → "24songs, 1hr 24min"（表記は lib/time-format.ts）
 *
 * Spotify は叩かない。既存セルの文字列を読み替えるだけ（冪等。変換済みの行は対象外になる）。
 * 読めない形式で60分以上らしいものは書き換えず、手で直す候補として一覧に出す。
 *
 * 実行方法:
 *   npx tsx scripts/convert-time-hr.ts           # dry-run
 *   npx tsx scripts/convert-time-hr.ts --apply   # 書き込み
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const apply = process.argv.includes("--apply");

const TIME_RE = /^(\d+)\s*songs?\s*,\s*(\d+)\s*min(?:\s+(\d+)\s*sec)?$/i;

async function main() {
  console.log(`モード: ${apply ? "APPLY（書き込みあり）" : "DRY-RUN（書き込みなし）"}\n`);

  const { google } = await import("googleapis");
  const { getGoogleAuth } = await import("../lib/google-auth");
  const { indexToColumnLetter, SHEET_COL } = await import("../lib/sheet-headers");
  const { formatTimeTracks } = await import("../lib/time-format");

  const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("RELEASE_MASTER_SPREADSHEET_ID is not set");

  const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Release Master'!A1:AZ" });
  const [headerRow = [], ...dataRows] = resp.data.values ?? [];
  const header = headerRow.map((c: string) => (c ?? "").trim());

  const timeIdx = header.indexOf(SHEET_COL.TIME);
  if (timeIdx < 0) throw new Error(`ヘッダー "${SHEET_COL.TIME}" が見つかりません`);
  // 表示用。シートの見出しは "Title"/"Artist" の場合がある
  const findCol = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const titleIdx = findCol(SHEET_COL.TITLE, "Title");
  const artistIdx = findCol(SHEET_COL.ARTIST, "Artist");
  const cTime = indexToColumnLetter(timeIdx);

  const writes: { range: string; values: string[][] }[] = [];
  const unparsed: string[] = [];

  dataRows.forEach((row, i) => {
    const rowNum = i + 2;
    const time = (row[timeIdx] ?? "").trim();
    if (!time) return;
    const label = `[row${rowNum}] ${row[artistIdx] ?? ""} - ${row[titleIdx] ?? ""}`;

    const m = TIME_RE.exec(time);
    if (!m) {
      // "hr" を含むものは変換済み。それ以外で60以上の分を含むものだけ要確認として出す
      const min = /(\d+)\s*min/i.exec(time);
      if (!/hr/i.test(time) && min && Number(min[1]) >= 60) unparsed.push(`${label} ... "${time}"`);
      return;
    }
    const [, tracks, min, sec = "0"] = m;
    if (Number(min) < 60) return;

    const next = formatTimeTracks(Number(tracks), (Number(min) * 60 + Number(sec)) * 1000);
    console.log(`${label} ... "${time}" → "${next}"`);
    writes.push({ range: `'Release Master'!${cTime}${rowNum}`, values: [[next]] });
  });

  console.log(`\n変換対象: ${writes.length} 件`);
  if (unparsed.length) {
    console.log(`\n形式を読めず書き換えなかった60分以上の値: ${unparsed.length} 件（手で確認してください）`);
    unparsed.forEach((l) => console.log(`  ${l}`));
  }

  if (!apply) {
    console.log("\n--- dry-run 完了。書き込むには --apply を付けて再実行してください。---");
    return;
  }
  if (writes.length === 0) return;

  // 1回あたりのリクエストを小さく保つ
  for (let i = 0; i < writes.length; i += 200) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: writes.slice(i, i + 200) },
    });
  }
  console.log(`\n${writes.length} 件を書き込みました。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
