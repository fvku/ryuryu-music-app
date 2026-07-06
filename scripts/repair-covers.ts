/**
 * Release Master の spotifyカバー列を Spotify API から正しい画像URLで修復する。
 * コアロジックは lib/ops/repair-covers.ts（管理画面と共通）。
 *
 * 実行方法:
 *   npx tsx scripts/repair-covers.ts          # coverUrl が空の行のみ
 *   npx tsx scripts/repair-covers.ts --all    # spotifyUrl がある全行を再取得
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const forceAll = process.argv.includes("--all");

async function main() {
  // 環境変数読み込み後にimportする
  const { repairCovers } = await import("../lib/ops/repair-covers");

  const result = await repairCovers({ forceAll, log: console.log });
  console.log(`\n完了: 修復 ${result.fixed}件 / 変更なし ${result.noChange}件 / 失敗 ${result.failed}件`);
}

main().catch((e) => { console.error(e); process.exit(1); });
