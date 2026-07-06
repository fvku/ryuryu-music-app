/**
 * Release Master の Spotify URL が空の行を対象に Spotify APIから再取得する。
 * コアロジックは lib/ops/refetch-spotify.ts（管理画面と共通）。
 *
 * 実行方法:
 *   npx tsx scripts/refetch-spotify.ts               # dry-run（確認のみ）
 *   npx tsx scripts/refetch-spotify.ts --apply        # 一致した行のみ書き込み
 *   npx tsx scripts/refetch-spotify.ts --apply --force # 不一致行も強制書き込み
 *   npx tsx scripts/refetch-spotify.ts --from-row=200 # 指定行以降のみ対象
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const FROM_ROW = (() => {
  const arg = process.argv.find((a) => a.startsWith("--from-row="));
  return arg ? parseInt(arg.split("=")[1]) : 0;
})();

async function main() {
  // 環境変数読み込み後にimportする
  const { refetchSpotifyUrls } = await import("../lib/ops/refetch-spotify");

  const result = await refetchSpotifyUrls({
    apply: APPLY,
    force: FORCE,
    fromRow: FROM_ROW,
    log: console.log,
  });

  console.log("\n========================================");
  console.log(`完了: 書き込み ${result.written} 件 / MISMATCH ${result.mismatched} 件 / 見つからず ${result.notFound} 件`);

  if (result.mismatches.length > 0) {
    console.log("\n⚠ MISMATCH 一覧（手動確認が必要）:");
    result.mismatches.forEach(({ rowNum, sheetTitle, sheetArtist, spotifyTitle, spotifyArtist }) => {
      console.log(`  行${rowNum}: "${sheetArtist}" / "${sheetTitle}" → Spotify: "${spotifyArtist}" / "${spotifyTitle}"`);
    });
    if (!FORCE) {
      console.log("\n  --apply --force を付けて再実行すると MISMATCH 行も強制書き込みします");
    }
  }

  if (!APPLY) {
    console.log("\n(dry-run) --apply を付けて実行すると書き込みます");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
