/**
 * 登録プレイリストの収録曲を取得し、Release Master の playlist 列に
 * 「どのプレイリストに入っているか」を書き込む。
 * コアロジックは lib/ops/sync-playlist-tags.ts。
 *
 * 対象プレイリストは lib/playlist-sources.ts で管理する。
 *
 * 実行方法:
 *   npx tsx scripts/sync-playlist-tags.ts                      # dry-run（当月のみ）
 *   npx tsx scripts/sync-playlist-tags.ts --apply              # 書き込み（当月のみ）
 *   npx tsx scripts/sync-playlist-tags.ts --apply --month=2026/08  # 指定月
 *   npx tsx scripts/sync-playlist-tags.ts --apply --all        # 全期間
 *   npx tsx scripts/sync-playlist-tags.ts --apply --init-column # playlist列を新設してから書き込み
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");
const INIT_COLUMN = process.argv.includes("--init-column");
const MONTH = (() => {
  if (process.argv.includes("--all")) return "all";
  const arg = process.argv.find((a) => a.startsWith("--month="));
  return arg ? arg.split("=")[1] : undefined;
})();

async function main() {
  const { syncPlaylistTags } = await import("../lib/ops/sync-playlist-tags");

  const result = await syncPlaylistTags({
    apply: APPLY,
    initColumn: INIT_COLUMN,
    month: MONTH,
    log: console.log,
  });

  if (result.index.failed.length > 0) {
    console.log("\n⚠ 取得できなかったプレイリスト:");
    for (const f of result.index.failed) console.log(`    ${f.label} (${f.playlistId}): ${f.error}`);
  }

  if (result.changes.length > 0) {
    console.log(`\n--- 更新内容（${result.changes.length}行） ---`);
    for (const c of result.changes.slice(0, 50)) {
      const existing = c.before ? `（既存: "${c.before}"）` : "";
      console.log(`  行${c.rowNum} [${c.matchedBy.join("+")}] ${c.artist} / ${c.title}: +${c.added.join(", ")}${existing}`);
    }
    if (result.changes.length > 50) console.log(`  ... 他 ${result.changes.length - 50}行`);
  }

  console.log("\n========================================");
  console.log(`対象 ${result.month === "all" ? "全期間" : result.month} ${result.scannedRows}行 / 書き込み ${result.written}行 / 変更なし ${result.unchanged}行 / シート未登録のアルバム ${result.unmatchedAlbums}枚`);

  if (!APPLY) {
    console.log("\n(dry-run) --apply を付けて実行すると書き込みます");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
