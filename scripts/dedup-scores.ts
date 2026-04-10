/**
 * scoresシートの重複エントリを削除する。
 * 同一 albumTitle + artistName + memberName の組み合わせで複数行ある場合、
 * submittedAt が最新の1行だけ残し、それ以外を空行に置き換える。
 *
 * 実行方法:
 *   npx tsx scripts/dedup-scores.ts
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY!;
let credentials;
try {
  credentials = JSON.parse(Buffer.from(keyJson, "base64").toString("utf-8"));
} catch {
  credentials = JSON.parse(keyJson);
}
if (credentials.private_key) {
  credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID!;

async function main() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A2:G",
  });

  const rows = res.data.values ?? [];
  console.log(`Total rows: ${rows.length}`);

  // key: albumTitle::artistName::memberName → { rowIndex (0-based from A2), submittedAt }
  const latestByKey = new Map<string, { rowIndex: number; submittedAt: string }>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const albumTitle  = (row[5] ?? "").trim();
    const artistName  = (row[6] ?? "").trim();
    const memberName  = (row[1] ?? "").trim().toLowerCase();
    const submittedAt = (row[4] ?? "").trim();

    if (!albumTitle && !artistName) continue; // 空行はスキップ

    const key = `${albumTitle}::${artistName}::${memberName}`;
    const existing = latestByKey.get(key);

    if (!existing || submittedAt > existing.submittedAt) {
      latestByKey.set(key, { rowIndex: i, submittedAt });
    }
  }

  // 残すべき行インデックスのセット
  const keepRows = new Set(Array.from(latestByKey.values()).map((v) => v.rowIndex));

  // 削除対象行（重複かつ最新でない行）
  const clearRequests: { range: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const albumTitle = (row[5] ?? "").trim();
    const artistName = (row[6] ?? "").trim();
    if (!albumTitle && !artistName) continue; // 既に空の行はスキップ

    if (!keepRows.has(i)) {
      const sheetRow = i + 2; // ヘッダーが1行目
      clearRequests.push({ range: `scores!A${sheetRow}:G${sheetRow}` });
    }
  }

  console.log(`Rows to keep: ${keepRows.size}`);
  console.log(`Duplicate rows to clear: ${clearRequests.length}`);

  if (clearRequests.length === 0) {
    console.log("No duplicates found.");
    return;
  }

  // 確認のため削除対象を表示
  for (const req of clearRequests) {
    const rowNum = parseInt(req.range.match(/\d+/)![0]) - 2;
    const row = rows[rowNum];
    console.log(`  Clear row ${rowNum + 2}: [${row[5]}] [${row[6]}] [${row[1]}] submittedAt=${row[4]}`);
  }

  // 実際にクリア
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: clearRequests.map((r) => r.range) },
  });

  console.log(`\nDone. Cleared ${clearRequests.length} duplicate rows.`);
}

main().catch(console.error);
