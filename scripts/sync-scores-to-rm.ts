/**
 * scoresシートのスコアを Release Master のメンバー列に書き戻す。
 *
 * 動作:
 *   - scores シートの全エントリを読み込み
 *   - 同一アルバム×同一メンバーは最新の submittedAt のみ使用
 *   - Release Master でアルバム行を特定し、メンバー列が空の場合のみ書き込む
 *   - --force を付けると既存値を上書きする
 *
 * 実行方法:
 *   npx tsx scripts/sync-scores-to-rm.ts            # 空セルのみ
 *   npx tsx scripts/sync-scores-to-rm.ts --force    # 上書きあり
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const force = process.argv.includes("--force");

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

const appSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID!;
const rmSpreadsheetId  = process.env.RELEASE_MASTER_SPREADSHEET_ID!;

// email → Release Master のメンバー列名
const EMAIL_TO_RM_COL: Record<string, string> = {
  "kwisoo1102@gmail.com":    "Kwisoo",
  "akyme68@gmail.com":       "Meri",
  "kohei.fuku0926@gmail.com": "Kohei",
  "edwardcannell93@gmail.com": "Eddie",
  "yoshinorihnw@gmail.com":  "Hanawa",
  "qururiquiqui@gmail.com":  "Kaede",
};

// レガシー名 → email
const LEGACY_TO_EMAIL: Record<string, string> = {
  "kohei":       "kohei.fuku0926@gmail.com",
  "kohei fukuda":"kohei.fuku0926@gmail.com",
  "meri":        "akyme68@gmail.com",
  "hanawa":      "yoshinorihnw@gmail.com",
  "eddie":       "edwardcannell93@gmail.com",
  "kwisoo":      "kwisoo1102@gmail.com",
  "kaede":       "qururiquiqui@gmail.com",
};

function normalizeEmail(memberName: string): string | null {
  const lower = (memberName ?? "").toLowerCase().trim();
  if (lower in EMAIL_TO_RM_COL) return lower;
  return LEGACY_TO_EMAIL[lower] ?? null;
}

function indexToColumnLetter(i: number): string {
  if (i < 26) return String.fromCharCode(i + 65);
  return String.fromCharCode(Math.floor(i / 26) + 64) + String.fromCharCode((i % 26) + 65);
}

async function main() {
  // 1. scores シートを読み込む (A2:G: reviewId, memberName, score, comment, submittedAt, albumTitle, artistName)
  const scoresRes = await sheets.spreadsheets.values.get({
    spreadsheetId: appSpreadsheetId,
    range: "scores!A2:G",
  });
  const scoreRows = scoresRes.data.values ?? [];
  console.log(`scores シート: ${scoreRows.length} 行`);

  // 同一アルバム×同一メンバーは最新 submittedAt のみ残す
  type ScoreEntry = { score: string; comment: string; submittedAt: string; albumTitle: string; artistName: string };
  const latestMap = new Map<string, ScoreEntry>();
  for (const row of scoreRows) {
    const memberName  = (row[1] ?? "").trim();
    const score       = (row[2] ?? "").trim();
    const comment     = (row[3] ?? "").trim();
    const submittedAt = (row[4] ?? "").trim();
    const albumTitle  = (row[5] ?? "").trim();
    const artistName  = (row[6] ?? "").trim();
    if (!albumTitle || !artistName || !score) continue;

    const email = normalizeEmail(memberName);
    if (!email) continue;

    const key = `${albumTitle}::${artistName}::${email}`;
    const existing = latestMap.get(key);
    if (!existing || submittedAt > existing.submittedAt) {
      latestMap.set(key, { score, comment, submittedAt, albumTitle, artistName });
    }
  }
  console.log(`重複除去後: ${latestMap.size} エントリ`);

  // 2. Release Master を読み込む（ヘッダー + 全データ）
  const rmRes = await sheets.spreadsheets.values.get({
    spreadsheetId: rmSpreadsheetId,
    range: "'Release Master'!A1:AZ",
  });
  const allRows = rmRes.data.values ?? [];
  if (allRows.length < 2) { console.log("RM にデータなし"); return; }

  const [headerRow, ...dataRows] = allRows;

  // ヘッダーから列インデックスを解決
  const colMap: Record<string, number> = {};
  headerRow.forEach((h: string, i: number) => { if (h) colMap[h.trim()] = i; });

  const titleIdx  = colMap["アルバム名"]   ?? 2;
  const artistIdx = colMap["アーティスト"] ?? 3;

  // アルバムTitle::Artist → rowNum (1-based, header=1)
  const rmRowMap = new Map<string, number>();
  for (let i = 0; i < dataRows.length; i++) {
    const t = (dataRows[i][titleIdx]  ?? "").trim();
    const a = (dataRows[i][artistIdx] ?? "").trim();
    if (t && a) rmRowMap.set(`${t}::${a}`, i + 2);
  }

  // 3. 書き込むセルを収集
  type CellWrite = { range: string; value: string; title: string; artist: string; member: string };
  const toWrite: CellWrite[] = [];
  const notFound: string[] = [];

  for (const [key, entry] of Array.from(latestMap.entries())) {
    const [albumTitle, artistName, email] = key.split("::");
    const colName = EMAIL_TO_RM_COL[email];
    if (!colName) continue;

    const colIdx = colMap[colName];
    if (colIdx === undefined) { console.warn(`列が見つかりません: ${colName}`); continue; }

    const rowNum = rmRowMap.get(`${albumTitle}::${artistName}`);
    if (!rowNum) {
      notFound.push(`${albumTitle} / ${artistName} (${colName})`);
      continue;
    }

    // 既存値チェック
    const existingVal = (dataRows[rowNum - 2]?.[colIdx] ?? "").trim();
    if (existingVal && !force) continue; // 空セルのみ（--force なし）

    const cellValue = entry.comment ? `${entry.score} ${entry.comment}` : entry.score;
    const colLetter = indexToColumnLetter(colIdx);
    toWrite.push({
      range: `'Release Master'!${colLetter}${rowNum}`,
      value: cellValue,
      title: albumTitle,
      artist: artistName,
      member: colName,
    });
  }

  console.log(`\n書き込み対象: ${toWrite.length} セル${force ? " (--force: 上書きあり)" : " (空セルのみ)"}`);
  if (notFound.length > 0) {
    console.log(`RMに行が見つからなかったアルバム (${notFound.length}件):`);
    notFound.slice(0, 10).forEach((s) => console.log(`  - ${s}`));
    if (notFound.length > 10) console.log(`  ... 他 ${notFound.length - 10} 件`);
  }

  if (toWrite.length === 0) {
    console.log("書き込む内容なし。");
    return;
  }

  // 4. batchUpdate で一括書き込み
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: rmSpreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: toWrite.map((w) => ({ range: w.range, values: [[w.value]] })),
    },
  });

  toWrite.forEach((w) => console.log(`  ✓ [${w.member}] ${w.title} / ${w.artist} = ${w.value}`));
  console.log(`\n完了: ${toWrite.length} セル書き込み`);
}

main().catch(console.error);
