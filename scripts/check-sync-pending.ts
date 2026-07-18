/**
 * sync_pending シートの内容を表示する診断スクリプト
 * 実行方法: npx tsx scripts/check-sync-pending.ts
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuth } from "../lib/google-auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(false) });
const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID!;

async function main() {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A1:D" });
  const rows = res.data.values ?? [];
  console.log(`sync_pending rows (including header): ${rows.length}`);
  rows.forEach((r, i) => console.log(`  [${i}] albumNo=${r[0]} email=${r[1]} cellValue=${r[2]} detectedAt=${r[3]}`));
}

main().catch(console.error);
