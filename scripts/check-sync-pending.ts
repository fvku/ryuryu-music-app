/**
 * sync_pending シートの内容を表示する診断スクリプト
 * 実行方法: npx tsx scripts/check-sync-pending.ts
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

const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID!;

async function main() {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A1:D" });
  const rows = res.data.values ?? [];
  console.log(`sync_pending rows (including header): ${rows.length}`);
  rows.forEach((r, i) => console.log(`  [${i}] albumNo=${r[0]} email=${r[1]} cellValue=${r[2]} detectedAt=${r[3]}`));
}

main().catch(console.error);
