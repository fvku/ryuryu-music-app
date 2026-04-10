/**
 * sync_pending にある albumNo に対して、scoresシートにエントリが存在するか確認する
 * 実行方法: npx tsx scripts/diagnose-pending.ts
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
const rmSpreadsheetId = process.env.RELEASE_MASTER_SPREADSHEET_ID!;

async function main() {
  const [pendingRes, scoresRes, rmRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "sync_pending!A2:D" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "scores!A2:G" }),
    sheets.spreadsheets.values.get({ spreadsheetId: rmSpreadsheetId, range: "'Release Master'!A2:D" }),
  ]);

  const pending = (pendingRes.data.values ?? []).filter(r => r[0] && r[0] !== "undefined");
  const scores = scoresRes.data.values ?? [];
  const rmRows = rmRes.data.values ?? [];

  // Build RM no → { albumTitle, artistName }
  const rmMap = new Map<string, { title: string; artist: string }>();
  for (const r of rmRows) {
    if (r[0]) rmMap.set(r[0].trim(), { title: (r[2] ?? "").trim(), artist: (r[3] ?? "").trim() });
  }

  // Build scores by reviewId (albumNo)
  const scoresByNo = new Map<string, { memberName: string; albumTitle: string; artistName: string }[]>();
  for (const r of scores) {
    if (!r[0]) continue;
    const no = r[0].trim();
    if (!scoresByNo.has(no)) scoresByNo.set(no, []);
    scoresByNo.get(no)!.push({ memberName: (r[1] ?? "").trim(), albumTitle: (r[5] ?? "").trim(), artistName: (r[6] ?? "").trim() });
  }

  console.log(`Pending entries: ${pending.length}`);
  for (const p of pending) {
    const albumNo = p[0];
    const email = p[1];
    const rm = rmMap.get(albumNo);
    const appScores = scoresByNo.get(albumNo) ?? [];
    const matchingScore = appScores.find(s => s.memberName.toLowerCase() === email.toLowerCase());

    if (!matchingScore) {
      console.log(`\n❌ NOT FOUND in scores: albumNo=${albumNo} email=${email}`);
      if (rm) {
        console.log(`   RM title/artist: [${rm.title}] / [${rm.artist}]`);
        if (appScores.length > 0) {
          console.log(`   Scores for this albumNo (stored title/artist):`);
          appScores.forEach(s => console.log(`     - member=${s.memberName} title=[${s.albumTitle}] artist=[${s.artistName}]`));
        } else {
          console.log(`   No scores at all for albumNo=${albumNo}`);
        }
      }
    } else {
      console.log(`✓  FOUND: albumNo=${albumNo} email=${email} storedTitle=[${matchingScore.albumTitle}]`);
    }
  }
}

main().catch(console.error);
