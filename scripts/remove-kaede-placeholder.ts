/**
 * scores シートから memberName = "kaede@placeholder.com" のエントリを削除する。
 * Kaede の実メールアドレスが確定したら bulk import で正しく取り込み直すこと。
 *
 * 実行方法:
 *   npx tsx scripts/remove-kaede-placeholder.ts
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

  const clearRanges: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const memberName = (rows[i][1] ?? "").trim().toLowerCase();
    if (memberName === "kaede@placeholder.com") {
      const sheetRow = i + 2;
      clearRanges.push(`scores!A${sheetRow}:G${sheetRow}`);
      console.log(`  Clear row ${sheetRow}: [${rows[i][5]}] [${rows[i][6]}] submittedAt=${rows[i][4]}`);
    }
  }

  console.log(`\nRows to clear: ${clearRanges.length}`);

  if (clearRanges.length === 0) {
    console.log("No kaede@placeholder.com entries found.");
    return;
  }

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: clearRanges },
  });

  console.log(`Done. Cleared ${clearRanges.length} kaede@placeholder.com entries.`);
}

main().catch(console.error);
