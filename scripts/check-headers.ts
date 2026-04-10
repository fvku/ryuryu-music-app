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
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID!;

function toColLetter(i: number): string {
  return i < 26
    ? String.fromCharCode(65 + i)
    : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

async function main() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Release Master'!1:1",
  });

  const headers = res.data.values?.[0] ?? [];
  console.log("Total columns:", headers.length);
  console.log("\nAll headers:");
  headers.forEach((h: string, i: number) => {
    console.log(`  ${toColLetter(i)} (${i}): "${h}"`);
  });

  const kaedeIdx = headers.findIndex((h: string) => h.trim() === "Kaede");
  if (kaedeIdx >= 0) {
    console.log(`\n✓ Kaede found at column ${toColLetter(kaedeIdx)} (index ${kaedeIdx})`);
  } else {
    console.log("\n✗ Kaede column NOT found");
  }
}

main().catch(console.error);
