"use client";

import { useCallback, useEffect, useState } from "react";
import { getDisplayName } from "@/lib/members";

interface QueueItem {
  key: string;
  albumUid: string;
  memberEmail: string;
  reason: "time_unknown" | "app_newer" | "same_time_conflict" | "rm_cleared" | "needs_review";
  rmValue: string;
  app: { score: number | null; comment: string; submittedAt: string } | null;
  rmRecordedAt: string | null;
  albumNo: string;
  albumTitle: string;
  artistName: string;
  firstSeenAt: string;
}

const REASON_LABEL: Record<QueueItem["reason"], string> = {
  time_unknown: "シートの編集時刻が分からない",
  app_newer: "アプリの方が新しい（シートへの反映漏れ）",
  same_time_conflict: "同じ時刻で内容が違う",
  rm_cleared: "シートで消された",
  needs_review: "一括貼り付けなどで要確認",
};

const fmt = (iso: string | null | undefined) => {
  if (!iso) return "不明";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const appText = (a: QueueItem["app"]) =>
  !a ? "（アプリにレビューなし）" : `${a.score === null ? "スコアなし" : a.score}${a.comment ? ` ${a.comment}` : ""}`;

/**
 * レビュー同期の確認待ち。Release Master とアプリで内容が違い、どちらが新しいか自動で決められないもの。
 * どちらかを選ぶまで両方そのまま残る（自動で上書きしない）。
 */
export default function ReviewSyncQueue({ accent, border }: { accent: string; border: string }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/review-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await call({ action: "list" });
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    }
  }, [call]);

  useEffect(() => {
    // 一覧の取得が終わってからstateを更新する非同期処理
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function runNow() {
    setRunning(true);
    setError(null);
    setNote(null);
    try {
      const data = await call({ action: "run" });
      setItems(data.items ?? []);
      setNote(`同期しました — アプリへ反映: ${data.applied?.length ?? 0}件 / 確認待ち: ${data.reviewCount}件${data.journalAvailable ? "" : "（編集履歴のシートが未設置のため、シートの手入力はすべて確認待ちになります）"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "同期に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  async function resolve(item: QueueItem, resolution: "adopt_rm" | "keep_app") {
    const label = resolution === "adopt_rm" ? "シートの内容をアプリに反映" : "アプリの内容をシートへ書き戻し";
    if (!window.confirm(`${getDisplayName(item.memberEmail)}『${item.albumTitle}』\n${label}します。よろしいですか？`)) return;
    setBusyKey(item.key);
    setError(null);
    try {
      const data = await call({ action: "resolve", key: item.key, resolution, expected: { rmValue: item.rmValue, appSubmittedAt: item.app?.submittedAt ?? "" } });
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: border }}>
      <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
        レビュー同期の確認待ち{items ? `（${items.length}件）` : ""}
      </h3>
      <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
        Release Masterとアプリでレビューが違い、どちらが新しいか自動で決められないものです。選ぶまでどちらも書き換えません。
        新しい方が分かるもの（シートの編集履歴がアプリより新しい）は自動で反映されます。
      </p>
      {note && <p className="text-xs mb-3" style={{ color: "#4ade80" }}>{note}</p>}
      {error && <p role="alert" className="text-red-400 text-xs mb-3">{error}</p>}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {items.map((it) => (
            <div key={it.key} className="rounded-xl p-3 border text-xs flex flex-col gap-1.5" style={{ borderColor: "var(--border-subtle)" }}>
              <p className="font-bold" style={{ color: "var(--text-primary)" }}>
                {getDisplayName(it.memberEmail)} — {it.artistName}『{it.albumTitle}』
              </p>
              <p style={{ color: accent }}>{REASON_LABEL[it.reason] ?? it.reason}</p>
              <p style={{ color: "var(--text-secondary)" }}>
                シート（{fmt(it.rmRecordedAt)}）: <span style={{ color: "var(--text-primary)" }}>{it.rmValue || "（空欄）"}</span>
              </p>
              <p style={{ color: "var(--text-secondary)" }}>
                アプリ（{fmt(it.app?.submittedAt)}）: <span style={{ color: "var(--text-primary)" }}>{appText(it.app)}</span>
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                <button type="button" disabled={busyKey !== null} onClick={() => resolve(it, "adopt_rm")}
                  className="px-3 py-1.5 rounded-lg border disabled:opacity-50" style={{ borderColor: accent, color: accent }}>
                  {it.rmValue ? "シートの内容を採用" : "アプリのレビューを消す"}
                </button>
                {it.app && (
                  <button type="button" disabled={busyKey !== null} onClick={() => resolve(it, "keep_app")}
                    className="px-3 py-1.5 rounded-lg border disabled:opacity-50" style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>
                    アプリの内容を残す（シートへ書き戻す）
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {items && items.length === 0 && <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>確認待ちはありません。</p>}

      <button type="button" onClick={runNow} disabled={running}
        className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50" style={{ borderColor: accent, color: accent }}>
        {running ? "同期中..." : "今すぐ同期する"}
      </button>
    </div>
  );
}
