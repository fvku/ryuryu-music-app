/**
 * Spotify URL列に誤ってカバー画像URL（https://i.scdn.co/image/...）が
 * 書き込まれている行を検出し、Spotify APIから正しいアルバムURLを再取得して修復する。
 * コアロジックは lib/ops/repair-spotify.ts（管理画面と共通）。
 *
 * 実行方法:
 *   npx tsx scripts/repair-spotify.ts
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

async function main() {
  // 環境変数読み込み後にimportする
  const { repairSpotifyUrls } = await import("../lib/ops/repair-spotify");

  const result = await repairSpotifyUrls({ log: console.log });
  console.log(`\n完了: ${result.fixed} 件修復, ${result.failed} 件失敗 (合計 ${result.total} 件)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
