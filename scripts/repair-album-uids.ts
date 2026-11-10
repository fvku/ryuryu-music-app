/**
 * scores / bookmarks / recommendations のうち、albumUid が作品名と食い違う行を
 * Release Master の作品名＋アーティスト名で付け直す。コアは lib/ops/repair-album-uids.ts。
 *
 *   npx tsx scripts/repair-album-uids.ts           # dry-run（確認のみ）
 *   npx tsx scripts/repair-album-uids.ts --apply   # 書き込み（UIDのセルだけ）
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env.local"), quiet: true });
const APPLY = process.argv.includes("--apply");

async function main() {
  const { repairAlbumUids } = await import("../lib/ops/repair-album-uids");
  const { fixes, unresolved } = await repairAlbumUids({ apply: APPLY });
  console.log(`モード: ${APPLY ? "APPLY" : "DRY-RUN"}  付け直し: ${fixes.length}件 / 決められない: ${unresolved.length}件`);
  for (const f of fixes) console.log(`  [直す] ${f.sheet} ${f.row}行  ${f.artist}『${f.title}』  ${f.from}（${f.fromTitle}）→ ${f.to}`);
  for (const u of unresolved) console.log(`  [保留:${u.reason}] ${u.sheet} ${u.row}行  ${u.artist}『${u.title}』  uid=${u.uid}（${u.uidTitle || "RMに無い"}）`);
  if (!APPLY && fixes.length > 0) console.log("\n書き込む場合は --apply を付けて再実行してください。");
}
main();
