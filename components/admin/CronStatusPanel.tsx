"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CRON_HEALTH_LABEL, formatCronReport, type CronHealth, type CronStatusReport } from "@/lib/cron-status";
import { errorMessageOf, fetchJsonOrThrow } from "@/lib/fetch-json";

const COLORS: Record<CronHealth, string> = { ok: "#4ade80", failed: "#f87171", stale: "#fbbf24", unknown: "#fbbf24" };
const dateLabel = (at: string) => new Date(at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

export default function CronStatusPanel({ summary = false }: { summary?: boolean }) {
  const [report, setReport] = useState<CronStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchJsonOrThrow<CronStatusReport>("/api/admin/cron-status", { signal: controller.signal, cache: "no-store" })
      .then(data => { if (!controller.signal.aborted) { setReport(data); setError(null); } })
      .catch(e => { if (!controller.signal.aborted) setError(errorMessageOf(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  function refresh() {
    setLoading(true);
    setCopyMessage("");
    setRevision(value => value + 1);
  }

  async function copyReport() {
    if (!report || error || loading) return;
    try {
      await navigator.clipboard.writeText(formatCronReport(report));
      setCopyMessage("報告文をコピーしました。ClaudeまたはCodexに貼り付けてください。");
    } catch {
      setCopyMessage("コピーできませんでした。下の報告文を選択してコピーしてください。");
    }
  }

  return (
    <section className="rounded-2xl border p-5" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }} aria-label="定期実行の状況" aria-busy={loading}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">定期実行の状況</h2>
        <button onClick={refresh} disabled={loading} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" style={{ borderColor: "var(--border-subtle)" }}>
          {loading ? "確認中…" : "更新"}
        </button>
      </div>
      {loading ? <p role="status" className="mt-3 text-sm">記録を確認しています…</p> : error ? (
        <p role="alert" className="mt-3 text-sm" style={{ color: "#f87171" }}>{error}</p>
      ) : report ? (
        <>
          <p role="status" className="mt-3 text-sm font-semibold" style={{ color: report.attentionCount ? "#fbbf24" : "#4ade80" }}>
            {report.attentionCount ? `${report.attentionCount}件の確認が必要です` : "直近の記録はすべて成功しています"}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>確認: {dateLabel(report.checkedAt)} JST · 担当: Kohei</p>
          {!report.logAvailable ? <p className="mt-3 text-sm">実行ログのシートがありません。Koheiに確認してください。</p> : null}
          {report.invalidRecordCount ? <p className="mt-3 text-sm">読み取れない定期実行の記録が{report.invalidRecordCount}件あります。元のログを確認してください。</p> : null}
          {summary ? null : (
            <>
              <div className="mt-5 space-y-4">
                {report.jobs.map(job => (
                  <article key={job.name} className="rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{job.label}</h3>
                      <span className="text-sm font-semibold" style={{ color: COLORS[job.health] }}>{CRON_HEALTH_LABEL[job.health]}</span>
                    </div>
                    <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>{job.schedule}</p>
                    <p className="mt-2 text-sm">最終記録: {job.latest ? `${dateLabel(job.latest.at)} JST` : "まだありません"}</p>
                    {job.health === "failed" ? <p className="mt-2 text-sm">失敗が記録されています。次の成功記録を確認するまで、Koheiが原因を確認します。</p> : null}
                    {job.health === "stale" ? <p className="mt-2 text-sm">36時間以上、新しい記録がありません。定期実行とログ保存の状態を確認してください。</p> : null}
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer">最近の記録（最大5件）</summary>
                      <ul className="mt-2 space-y-1">
                        {job.recent.map((run, i) => <li key={`${run.at}-${i}`}>{dateLabel(run.at)} JST · {run.result === "ok" ? "成功" : "失敗"}</li>)}
                      </ul>
                    </details>
                  </article>
                ))}
              </div>
              <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                この画面は保存された記録を確認するものです。自動更新はしません。実行の停止やログ保存の失敗も分かるよう、成功の記録でも36時間を過ぎたら確認を促します。レビュー同期にはホームからの実行も含みます。
              </p>
              <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
                <h3 className="text-sm font-semibold">Claude・Codexに相談する</h3>
                <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>報告文をコピーして、調査を依頼できます。コピーだけではAIへ送信されません。</p>
                <button onClick={copyReport} className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-subtle)" }}>AIへの報告文をコピー</button>
                <p role="status" className="mt-2 text-xs">{copyMessage}</p>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer">報告文を表示</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg p-3 select-text" style={{ backgroundColor: "var(--bg-primary)" }}>{formatCronReport(report)}</pre>
                </details>
              </div>
            </>
          )}
        </>
      ) : null}
      {summary ? <Link href="/admin/operations" className="mt-3 inline-block text-sm underline underline-offset-4">定期実行の状況を見る →</Link> : null}
    </section>
  );
}
