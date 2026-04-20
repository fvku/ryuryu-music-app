/**
 * scoresシートの重複エントリを削除する（memberName 正規化版）。
 *
 * 従来の dedup-scores.ts との違い:
 *   - memberName を canonical email に正規化した上でキーを作る。
 *     例: "Kwisoo" と "kwisoo1102@gmail.com" を同一メンバーとして扱う。
 *   - 同スコア・同コメントのグループ → 最も古い submittedAt の行を残す
 *     （cron が誤って作った新タイムスタンプのエントリを削除するため）
 *   - スコアまたはコメントが異なるグループ → 最も新しい submittedAt の行を残す
 *     （ユーザーが実際にスコアを更新した場合）
 *
 * 実行方法:
 *   npx tsx scripts/dedup-scores-normalized.ts
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

// ── 短縮名 → email のマッピング（lib/members.ts と同期） ──
const LEGACY_NAME_TO_EMAIL: Record<string, string> = {
  "kohei": "kohei.fuku0926@gmail.com",
  "kohei fukuda": "kohei.fuku0926@gmail.com",
  "meri": "akyme68@gmail.com",
  "hanawa": "yoshinorihnw@gmail.com",
  "eddie": "edwardcannell93@gmail.com",
  "kwisoo": "kwisoo1102@gmail.com",
  "kaede": "qururiquiqui@gmail.com",
};

const EMAIL_TO_SHORT_NAME: Record<string, string> = {
  "kohei.fuku0926@gmail.com": "Kohei",
  "akyme68@gmail.com": "Meri",
  "yoshinorihnw@gmail.com": "Hanawa",
  "edwardcannell93@gmail.com": "Eddie",
  "kwisoo1102@gmail.com": "Kwisoo",
  "qururiquiqui@gmail.com": "Kaede",
};

function normalizeToEmail(memberName: string): string {
  const lower = (memberName ?? "").toLowerCase().trim();
  if (lower in EMAIL_TO_SHORT_NAME) return lower;
  return LEGACY_NAME_TO_EMAIL[lower] ?? lower;
}

async function main() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A2:G",
  });

  const rows = res.data.values ?? [];
  console.log(`Total rows: ${rows.length}`);

  // key: albumTitle::artistName::normalizedEmail → 残すべき行インデックス
  // value: { rowIndex, submittedAt, score, comment }
  const groupMap = new Map<string, { rowIndex: number; submittedAt: string; score: string; comment: string }[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const albumTitle  = (row[5] ?? "").trim();
    const artistName  = (row[6] ?? "").trim();
    const memberName  = (row[1] ?? "").trim();
    const submittedAt = (row[4] ?? "").trim();
    const score       = (row[2] ?? "").trim();
    const comment     = (row[3] ?? "").trim();

    if (!albumTitle && !artistName) continue;

    const normalizedEmail = normalizeToEmail(memberName);
    const key = `${albumTitle}::${artistName}::${normalizedEmail}`;

    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push({ rowIndex: i, submittedAt, score, comment });
  }

  // 各グループから残す行インデックスを決定
  const keepRows = new Set<number>();

  for (const entries of Array.from(groupMap.values())) {
    if (entries.length === 1) {
      keepRows.add(entries[0].rowIndex);
      continue;
    }

    // スコア・コメントがすべて同じか確認
    const allSame = entries.every(
      (e: typeof entries[0]) => e.score === entries[0].score && e.comment === entries[0].comment
    );

    if (allSame) {
      // 同スコア・同コメント → 最も古い submittedAt を残す（cron が誤作した新エントリを削除）
      const oldest = entries.reduce(
        (a: typeof entries[0], b: typeof entries[0]) => (a.submittedAt <= b.submittedAt ? a : b)
      );
      keepRows.add(oldest.rowIndex);
    } else {
      // スコアまたはコメントが異なる → 最も新しい submittedAt を残す（実際の更新）
      const newest = entries.reduce(
        (a: typeof entries[0], b: typeof entries[0]) => (a.submittedAt >= b.submittedAt ? a : b)
      );
      keepRows.add(newest.rowIndex);
    }
  }

  // 削除対象の行
  const clearRequests: { range: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const albumTitle = (row[5] ?? "").trim();
    const artistName = (row[6] ?? "").trim();
    if (!albumTitle && !artistName) continue;

    if (!keepRows.has(i)) {
      const sheetRow = i + 2;
      clearRequests.push({ range: `scores!A${sheetRow}:G${sheetRow}` });
    }
  }

  console.log(`Rows to keep: ${keepRows.size}`);
  console.log(`Duplicate rows to clear: ${clearRequests.length}`);

  if (clearRequests.length === 0) {
    console.log("No duplicates found.");
    return;
  }

  for (const req of clearRequests) {
    const rowNum = parseInt(req.range.match(/\d+/)![0]) - 2;
    const row = rows[rowNum];
    console.log(`  Clear row ${rowNum + 2}: [${row[5]}] [${row[6]}] member=${row[1]} submittedAt=${row[4]} score=${row[2]}`);
  }

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: clearRequests.map((r) => r.range) },
  });

  console.log(`\nDone. Cleared ${clearRequests.length} duplicate rows.`);
}

main().catch(console.error);
