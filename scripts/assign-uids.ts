/**
 * Release Master の全行に安定ID（UID）を採番する。
 * コアロジックは lib/ops/assign-uids.ts（管理画面と共通）。
 *
 * Spotify URL列（AD列）が埋まっている行のみが採番対象（内容確定済みの目印）。
 * 正式リリース日より前に先回り登録された行はURLが空なので自動的にスキップされる。
 *
 * 実行方法:
 *   npx tsx scripts/assign-uids.ts           # dry-run（確認のみ）
 *   npx tsx scripts/assign-uids.ts --apply   # 書き込み
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");

async function main() {
  const { assignUids } = await import("../lib/ops/assign-uids");

  const result = await assignUids({ apply: APPLY, log: console.log });

  if (result.pendingDetails.length > 0) {
    console.log(`\n--- URL未確定でスキップした行（Spotify URL取得後に再実行してください） ---`);
    for (const r of result.pendingDetails) console.log(`    [${r.no}] ${r.artist} / ${r.title}`);
  }

  if (!APPLY) {
    console.log("\n(dry-run) --apply を付けて実行すると書き込みます");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
