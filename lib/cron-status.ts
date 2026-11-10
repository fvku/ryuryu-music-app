/** admin_logs から表示・AIへの共有に必要な情報だけを取り出す。detail・メールは返さない。 */
export const CRON_JOBS = [
  { name: "sync-playlist-tags", label: "プレイリスト収録タグ", schedule: "毎日 0:30 JST" },
  { name: "sync-release-master", label: "レビュー同期", schedule: "毎日 4:00 JST（ホーム表示時にも実行）" },
  { name: "supabase-keepalive", label: "保存先の休止防止・期限切れ音声の削除", schedule: "毎日 12:00 JST" },
] as const;

export type CronName = typeof CRON_JOBS[number]["name"];
export type CronHealth = "ok" | "failed" | "stale" | "unknown";
export type CronRun = { at: string; result: "ok" | "failed" };
export type CronJobStatus = typeof CRON_JOBS[number] & {
  health: CronHealth;
  latest: CronRun | null;
  recent: CronRun[];
};
export type CronStatusReport = {
  checkedAt: string;
  logAvailable: boolean;
  invalidRecordCount: number;
  attentionCount: number;
  jobs: CronJobStatus[];
};

export const CRON_STALE_MS = 36 * 60 * 60 * 1000;
export const CRON_HEALTH_LABEL: Record<CronHealth, string> = {
  ok: "成功", failed: "失敗", stale: "記録が古い", unknown: "記録なし",
};

export function summarizeCronLogs(
  rows: readonly (readonly unknown[])[],
  now = new Date(),
  logAvailable = true,
): CronStatusReport {
  const runs = new Map<string, (CronRun & { time: number; row: number })[]>();
  let invalidRecordCount = 0;
  const nowMs = now.getTime();
  rows.forEach((row, index) => {
    const [timestamp, actor, action, result] = row;
    if (actor !== "cron" || !CRON_JOBS.some(job => action === `cron:${job.name}`)) return;
    const time = typeof timestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)
      ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(time) || time > nowMs + 5 * 60 * 1000 || (result !== "ok" && result !== "failed")) {
      invalidRecordCount++;
      return;
    }
    const name = (action as string).slice("cron:".length);
    const list = runs.get(name) ?? [];
    list.push({ at: new Date(time).toISOString(), result, time, row: index });
    runs.set(name, list);
  });
  const jobs = CRON_JOBS.map(job => {
    // 同じ記録時刻なら後に追記された行を採る。シートの表示順だけに依存しない。
    const sorted = (runs.get(job.name) ?? []).sort((a, b) => b.time - a.time || b.row - a.row);
    const latest = sorted[0];
    const health: CronHealth = !latest ? "unknown"
      : latest.result === "failed" ? "failed"
      : nowMs - latest.time >= CRON_STALE_MS ? "stale" : "ok";
    const recent = sorted.slice(0, 5).map(({ at, result }) => ({ at, result }));
    return { ...job, health, latest: recent[0] ?? null, recent };
  });
  return {
    checkedAt: now.toISOString(), logAvailable, invalidRecordCount,
    attentionCount: jobs.filter(job => job.health !== "ok").length + (invalidRecordCount > 0 ? 1 : 0),
    jobs,
  };
}

export function formatCronReport(report: CronStatusReport): string {
  return [
    "ryuryu-music 定期実行の確認", `確認日時: ${report.checkedAt}`,
    `確認が必要: ${report.attentionCount}件`,
    ...report.jobs.map(job => `- ${job.label} (${job.name}): ${CRON_HEALTH_LABEL[job.health]} / 最終記録: ${job.latest?.at ?? "なし"}`),
    ...(!report.logAvailable ? ["admin_logs シートがありません。"] : []),
    ...(report.invalidRecordCount ? [`読み取れないCron記録: ${report.invalidRecordCount}件`] : []),
    "管理画面: /admin/operations", "担当: Kohei",
    "docs/operations.md と関連するCronルートを読み、原因と修正案を確認してください。",
    "本番Sheetsへの変更・復元、Apps Scriptの変更、PRのマージは実行しないでください。",
    "コードを変更する前に git status を確認し、未コミット変更があればKoheiに確認してください。",
  ].join("\n");
}
