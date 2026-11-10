/** AIの定期確認にも使う読み取り専用コマンド。終了コード: 0=異常なし / 1=要確認 / 2=取得失敗。 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { readCronStatus } from "../lib/cron-status-store";
import { formatCronReport } from "../lib/cron-status";

config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });

async function main() {
  const report = await readCronStatus();
  console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatCronReport(report));
  process.exitCode = report.attentionCount ? 1 : 0;
}

main().catch(() => {
  console.error("定期実行の記録を取得できませんでした。環境変数・Sheetsの共有設定・通信状態を確認してください。");
  process.exitCode = 2;
});
