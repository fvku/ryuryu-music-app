/**
 * Release Master の Time列(G) が空のアルバムを Spotify から補完する。
 * コアロジックは lib/ops/fill-time-tracks.ts（管理画面と共通）。
 *
 * 実行方法:
 *   npx tsx scripts/fill-time-tracks.ts                   # dry-run（空のみ）
 *   npx tsx scripts/fill-time-tracks.ts --apply           # 書き込み（空のみ）
 *   npx tsx scripts/fill-time-tracks.ts --apply --force   # 書き込み（全上書き）
 *   npx tsx scripts/fill-time-tracks.ts --apply --force --from-row=915  # 指定行以降のみ
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const fromRowArg = process.argv.find((a) => a.startsWith("--from-row="));
const fromRow = fromRowArg ? parseInt(fromRowArg.split("=")[1], 10) : 1;

async function main() {
  console.log(`モード: ${apply ? "APPLY（書き込みあり）" : "DRY-RUN（書き込みなし）"}${force ? " + FORCE（全上書き）" : ""}${fromRow > 1 ? ` + FROM row${fromRow}` : ""}\n`);

  // 環境変数読み込み後にimportする
  const { fillTimeTracks } = await import("../lib/ops/fill-time-tracks");

  const result = await fillTimeTracks({ apply, force, fromRow, log: console.log });

  console.log(`\n結果: ${result.ok} 件取得, ${result.skipNotFound} 件スキップ（取得失敗）, ${result.skipNoUrl} 件対象外（Spotify URLなし）`);
  if (!apply) {
    console.log("\n--- dry-run 完了。書き込むには --apply を付けて再実行してください。---");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
