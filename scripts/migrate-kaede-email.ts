/**
 * kaede@placeholder.com → qururiquiqui@gmail.com への差し替えスクリプト。
 *
 * 対象シート:
 *   - scores!B列 (memberName)
 *   - recommendations!B列 (recommenderId)
 *   - recommendations!I列 (mentionedEmails, カンマ区切り内)
 *
 * dry-run モード（デフォルト）では変更内容を表示するだけで書き込まない。
 * 実際に書き込む場合は --apply を付けて実行する。
 *
 * 実行方法:
 *   npx tsx scripts/migrate-kaede-email.ts          # dry-run
 *   npx tsx scripts/migrate-kaede-email.ts --apply  # 実際に書き込む
 *
 * 注意: 実行後に重複が生じた場合は dedup-scores-normalized.ts を続けて実行すること。
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const apply = process.argv.includes("--apply");

const OLD_EMAIL = "kaede@placeholder.com";
const NEW_EMAIL = "qururiquiqui@gmail.com";

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

// ── scores シートの処理 ──────────────────────────────────────────────────────

async function migrateScores() {
  console.log("\n=== scores シート ===");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "scores!A2:G",
  });
  const rows = res.data.values ?? [];
  console.log(`総行数: ${rows.length}`);

  // アルバムキー → 行インデックス・submittedAt のマップを全メンバー分構築
  type RowMeta = { rowIndex: number; sheetRow: number; submittedAt: string; email: string };
  const keyToRows = new Map<string, RowMeta[]>();

  for (let i = 0; i < rows.length; i++) {
    const memberName  = (rows[i][1] ?? "").trim().toLowerCase();
    const albumTitle  = (rows[i][5] ?? "").trim();
    const artistName  = (rows[i][6] ?? "").trim();
    const submittedAt = (rows[i][4] ?? "").trim();
    if (!albumTitle && !artistName) continue;

    // placeholder を正規メールとして扱ってキーを統一
    const normalizedEmail = memberName === OLD_EMAIL ? NEW_EMAIL : memberName;
    const key = `${albumTitle}::${artistName}::${normalizedEmail}`;
    if (!keyToRows.has(key)) keyToRows.set(key, []);
    keyToRows.get(key)!.push({ rowIndex: i, sheetRow: i + 2, submittedAt, email: memberName });
  }

  // placeholder を含むキーのみ処理
  const emailUpdates: { range: string; value: string }[] = [];
  const clearRanges: string[] = [];

  for (const [, entries] of Array.from(keyToRows.entries())) {
    const hasPlaceholder = entries.some((e) => e.email === OLD_EMAIL);
    if (!hasPlaceholder) continue;

    if (entries.length === 1) {
      // 重複なし → メールアドレスだけ差し替え
      const e = entries[0];
      emailUpdates.push({ range: `scores!B${e.sheetRow}`, value: NEW_EMAIL });
      console.log(`  → row ${e.sheetRow}: [${rows[e.rowIndex][5]}] [${rows[e.rowIndex][6]}] を ${NEW_EMAIL} に差し替え`);
    } else {
      // 重複あり → 最新 submittedAt を残し、それ以外をクリア
      const newest = entries.reduce((a, b) => (a.submittedAt >= b.submittedAt ? a : b));
      const others = entries.filter((e) => e !== newest);

      // 残す行のメールが placeholder なら更新
      if (newest.email === OLD_EMAIL) {
        emailUpdates.push({ range: `scores!B${newest.sheetRow}`, value: NEW_EMAIL });
      }
      for (const e of others) {
        clearRanges.push(`scores!A${e.sheetRow}:G${e.sheetRow}`);
        console.warn(`  ⚠ 重複: row ${e.sheetRow} [${rows[e.rowIndex][5]}] [${rows[e.rowIndex][6]}] submittedAt=${e.submittedAt} → クリア（最新 row ${newest.sheetRow} を残す）`);
      }
      console.log(`  → row ${newest.sheetRow}: [${rows[newest.rowIndex][5]}] [${rows[newest.rowIndex][6]}] 最新として残す (submittedAt=${newest.submittedAt})`);
    }
  }

  console.log(`\n差し替え: ${emailUpdates.length} 行, 重複クリア: ${clearRanges.length} 行`);

  if (!apply) return;

  if (emailUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: emailUpdates.map((u) => ({ range: u.range, values: [[u.value]] })),
      },
    });
    console.log(`完了: ${emailUpdates.length} 行のメールアドレスを更新しました。`);
  }

  if (clearRanges.length > 0) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: { ranges: clearRanges },
    });
    console.log(`完了: ${clearRanges.length} 行の重複エントリをクリアしました。`);
  }

  if (emailUpdates.length === 0 && clearRanges.length === 0) {
    console.log("書き込みなし。");
  }
}

// ── recommendations シートの処理 ─────────────────────────────────────────────

async function migrateRecommendations() {
  console.log("\n=== recommendations シート ===");

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "recommendations!A2:I",
    });
  } catch {
    console.log("recommendations シートが存在しないかデータなし。スキップ。");
    return;
  }

  const rows = res.data.values ?? [];
  console.log(`総行数: ${rows.length}`);

  type CellUpdate = { range: string; value: string; description: string };
  const updates: CellUpdate[] = [];

  for (let i = 0; i < rows.length; i++) {
    const sheetRow = i + 2;
    const recommenderId = (rows[i][1] ?? "").trim().toLowerCase();
    const mentionedRaw  = (rows[i][8] ?? "").trim();

    // B列: recommenderId
    if (recommenderId === OLD_EMAIL) {
      updates.push({
        range: `recommendations!B${sheetRow}`,
        value: NEW_EMAIL,
        description: `row ${sheetRow} recommenderId: ${OLD_EMAIL} → ${NEW_EMAIL}`,
      });
      console.log(`  → row ${sheetRow} [recommenderId] 差し替え`);
    }

    // I列: mentionedEmails (カンマ区切り)
    if (mentionedRaw.toLowerCase().includes(OLD_EMAIL)) {
      const replaced = mentionedRaw
        .split(",")
        .map((e: string) => (e.trim().toLowerCase() === OLD_EMAIL ? NEW_EMAIL : e.trim()))
        .join(",");
      updates.push({
        range: `recommendations!I${sheetRow}`,
        value: replaced,
        description: `row ${sheetRow} mentionedEmails: "${mentionedRaw}" → "${replaced}"`,
      });
      console.log(`  → row ${sheetRow} [mentionedEmails] 差し替え: "${mentionedRaw}" → "${replaced}"`);
    }
  }

  console.log(`\n対象: ${updates.length} セルを差し替え`);

  if (!apply) return;
  if (updates.length === 0) { console.log("書き込みなし。"); return; }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    },
  });
  console.log(`完了: ${updates.length} セルを更新しました。`);
}

// ── メイン ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`モード: ${apply ? "APPLY（書き込みあり）" : "DRY-RUN（書き込みなし）"}`);
  console.log(`${OLD_EMAIL} → ${NEW_EMAIL}`);

  await migrateScores();
  await migrateRecommendations();

  if (!apply) {
    console.log("\n--- dry-run 完了。実際に書き込む場合は --apply を付けて再実行してください。---");
  } else {
    console.log("\n--- 全処理完了 ---");
    console.log("次のステップ: 重複があった場合は npx tsx scripts/dedup-scores-normalized.ts を実行してください。");
  }
}

main().catch(console.error);
