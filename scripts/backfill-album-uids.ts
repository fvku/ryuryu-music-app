/**
 * scores / bookmarks / recommendations の各行に Release Master の UID を紐付ける
 * （UIDフェーズ2の移行スクリプト）。コアロジックは lib/ops/backfill-album-uids.ts（管理画面と共通）。
 *
 * 実行方法:
 *   npx tsx scripts/backfill-album-uids.ts           # dry-run（確認のみ）
 *   npx tsx scripts/backfill-album-uids.ts --apply   # 書き込み
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");

async function main() {
  const { backfillAlbumUids } = await import("../lib/ops/backfill-album-uids");

  await backfillAlbumUids({ apply: APPLY, log: console.log });

  if (!APPLY) {
    console.log("\n--- dry-run 完了。実際に書き込む場合は --apply を付けて再実行してください。---");
  } else {
    console.log("\n--- 全処理完了 ---");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
