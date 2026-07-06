/**
 * scoresシートのスコアを Release Master のメンバー列に書き戻す。
 * コアロジックは lib/ops/sync-scores-to-rm.ts（管理画面と共通）。
 *
 * 実行方法:
 *   npx tsx scripts/sync-scores-to-rm.ts            # 空セルのみ
 *   npx tsx scripts/sync-scores-to-rm.ts --force    # 上書きあり
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const force = process.argv.includes("--force");

async function main() {
  // 環境変数読み込み後にimportする
  const { syncScoresToRm } = await import("../lib/ops/sync-scores-to-rm");

  const result = await syncScoresToRm({ force, log: console.log });

  if (result.notFoundList.length > 0) {
    console.log(`\nRMに行が見つからなかったアルバム (${result.notFoundList.length}件):`);
    result.notFoundList.slice(0, 10).forEach((s) => console.log(`  - ${s}`));
    if (result.notFoundList.length > 10) console.log(`  ... 他 ${result.notFoundList.length - 10} 件`);
  }

  console.log(`\n完了: ${result.written} セル書き込み / スキップ ${result.skipped} / 行なし ${result.notFound}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
