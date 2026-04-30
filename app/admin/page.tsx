"use client";

import { useState } from "react";

type Step = "auth" | "main";

export default function AdminPage() {
  const [step, setStep] = useState<Step>("auth");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Bulk import
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; pendingCleared: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // fill-time-tracks
  type FillDetail = { row: number; artist: string; title: string; result: string };
  type FillResult = { ok: number; skipNotFound: number; skipDateMismatch: number; total: number; details: FillDetail[]; dryRun: boolean };
  const [fillLoading, setFillLoading] = useState(false);
  const [fillResult, setFillResult] = useState<FillResult | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);
  const [fillDryRun, setFillDryRun] = useState(true);
  const [fillLimit, setFillLimit] = useState(15);

  // dedup-scores
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupResult, setDedupResult] = useState<{ total: number; kept: number; cleared: number } | null>(null);
  const [dedupError, setDedupError] = useState<string | null>(null);

  // repair-covers
  const [coversLoading, setCoversLoading] = useState(false);
  const [coversResult, setCoversResult] = useState<{ total: number; fixed: number; failed: number; noChange: number; message?: string } | null>(null);
  const [coversError, setCoversError] = useState<string | null>(null);
  const [coversLimit, setCoversLimit] = useState(20);

  // repair-spotify
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairResult, setRepairResult] = useState<{ total: number; fixed: number; failed: number; message?: string } | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  // sync-scores-to-rm
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ written: number; notFound: number; skipped: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncForce, setSyncForce] = useState(false);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) { setAuthError("パスワードを入力してください"); return; }
    setAuthLoading(true);
    setStep("main");
    setAuthLoading(false);
  }

  async function handleBulkImport() {
    setImportLoading(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/bulk-import-release-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取り込みに失敗しました");
      setImportResult(data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleFillTimeTracks() {
    setFillLoading(true);
    setFillError(null);
    setFillResult(null);
    try {
      const res = await fetch("/api/admin/fill-time-tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, dryRun: fillDryRun, limit: fillLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setFillResult(data);
    } catch (err) {
      setFillError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setFillLoading(false);
    }
  }

  async function handleDedupScores() {
    setDedupLoading(true);
    setDedupError(null);
    setDedupResult(null);
    try {
      const res = await fetch("/api/admin/dedup-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setDedupResult(data);
    } catch (err) {
      setDedupError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setDedupLoading(false);
    }
  }

  async function handleRepairCovers() {
    setCoversLoading(true);
    setCoversError(null);
    setCoversResult(null);
    try {
      const res = await fetch("/api/admin/repair-covers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, limit: coversLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setCoversResult(data);
    } catch (err) {
      setCoversError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setCoversLoading(false);
    }
  }

  async function handleRepairSpotify() {
    setRepairLoading(true);
    setRepairError(null);
    setRepairResult(null);
    try {
      const res = await fetch("/api/admin/repair-spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setRepairResult(data);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setRepairLoading(false);
    }
  }

  async function handleSyncScoresToRm() {
    setSyncLoading(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/sync-scores-to-rm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, force: syncForce }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setSyncResult(data);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSyncLoading(false);
    }
  }

  if (step === "auth") {
    return (
      <div className="max-w-sm mx-auto mt-16">
        <div className="rounded-2xl p-8 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <div className="text-center mb-6">
            <span className="text-4xl">🔐</span>
            <h1 className="mt-3 text-xl font-bold" style={{ color: "var(--text-primary)" }}>管理者ログイン</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>管理者パスワードを入力してください</p>
          </div>
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none"
              style={{ backgroundColor: "#12121a", borderColor: authError ? "rgba(239,68,68,0.5)" : "var(--border-subtle)", color: "var(--text-primary)" }}
            />
            {authError && <p className="text-red-400 text-sm">{authError}</p>}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {authLoading ? "確認中..." : "ログイン"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>管理者ページ</h1>
        <button
          onClick={() => { setStep("auth"); setPassword(""); }}
          className="text-sm px-4 py-2 rounded-xl border"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          ログアウト
        </button>
      </div>

      <div className="flex flex-col gap-4">

        {/* Bulk import */}
        <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Release Master 一括取り込み</h3>
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>Release Masterの全スコアをアプリのscoresシートに取り込みます。すでに取り込み済みのものはスキップされます。</p>
          {importResult && (
            <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
              <p style={{ color: "#4ade80" }}>取り込み完了 — 新規: {importResult.imported}件 / スキップ: {importResult.skipped}件 / pending削除: {importResult.pendingCleared}件</p>
            </div>
          )}
          {importError && <p className="text-red-400 text-xs mb-3">{importError}</p>}
          <button onClick={handleBulkImport} disabled={importLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            {importLoading ? "取り込み中..." : "実行"}
          </button>
        </div>

        {/* fill-time-tracks */}
        <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Time・曲数補完</h3>
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Time列が空のアルバムをSpotifyから補完します。リリース日が一致したアルバムのみSpotify URLも書き込まれます。未発売アルバムは自動スキップ。
          </p>
          <div className="flex flex-wrap gap-4 mb-3 items-center">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={fillDryRun} onChange={e => setFillDryRun(e.target.checked)} className="rounded" />
              Dry-run（書き込みなし）
            </label>
            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              最大
              <select value={fillLimit} onChange={e => setFillLimit(Number(e.target.value))}
                className="px-2 py-1 rounded-lg border text-sm"
                style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>
                {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n}件</option>)}
              </select>
            </label>
          </div>
          {fillResult && (
            <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: fillResult.dryRun ? "rgba(99,102,241,0.1)" : "rgba(34,197,94,0.1)", borderColor: fillResult.dryRun ? "rgba(99,102,241,0.3)" : "rgba(34,197,94,0.3)" }}>
              <p className="font-medium mb-1" style={{ color: fillResult.dryRun ? "#a5b4fc" : "#4ade80" }}>
                {fillResult.dryRun ? "Dry-run 完了" : "書き込み完了"} — {fillResult.total}件対象 / {fillResult.ok}件成功 / {fillResult.skipDateMismatch}件日付不一致 / {fillResult.skipNotFound}件未掲載
              </p>
              <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto mt-1">
                {fillResult.details.map((d, i) => (
                  <span key={i} style={{ color: "var(--text-secondary)" }}>row{d.row}: {d.artist} - {d.title} → {d.result}</span>
                ))}
              </div>
            </div>
          )}
          {fillError && <p className="text-red-400 text-xs mb-3">{fillError}</p>}
          <button onClick={handleFillTimeTracks} disabled={fillLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            {fillLoading ? "実行中..." : "実行"}
          </button>
        </div>

        {/* dedup-scores */}
        <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>スコア重複除去</h3>
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            scoresシートの重複エントリを削除します。同スコア・同コメント→最古を残す。スコアが異なる→最新を残す。
          </p>
          {dedupResult && (
            <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
              <p style={{ color: "#4ade80" }}>完了 — 総行数: {dedupResult.total} / 保持: {dedupResult.kept} / 削除: {dedupResult.cleared}</p>
            </div>
          )}
          {dedupError && <p className="text-red-400 text-xs mb-3">{dedupError}</p>}
          <button onClick={handleDedupScores} disabled={dedupLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            {dedupLoading ? "実行中..." : "実行"}
          </button>
        </div>

        {/* repair-covers */}
        <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>カバー画像補完</h3>
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Spotify URLがあるのにカバー画像URLが空の行をSpotifyから補完します。
          </p>
          <div className="mb-3">
            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              最大
              <select value={coversLimit} onChange={e => setCoversLimit(Number(e.target.value))}
                className="px-2 py-1 rounded-lg border text-sm"
                style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>
                {[10, 20, 30].map(n => <option key={n} value={n}>{n}件</option>)}
              </select>
            </label>
          </div>
          {coversResult && (
            <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
              <p style={{ color: "#4ade80" }}>
                {coversResult.message ?? `完了 — 対象: ${coversResult.total} / 修復: ${coversResult.fixed} / 変更なし: ${coversResult.noChange} / 失敗: ${coversResult.failed}`}
              </p>
            </div>
          )}
          {coversError && <p className="text-red-400 text-xs mb-3">{coversError}</p>}
          <button onClick={handleRepairCovers} disabled={coversLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            {coversLoading ? "実行中..." : "実行"}
          </button>
        </div>

        {/* repair-spotify */}
        <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Spotify URL修復</h3>
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            Spotify URL列に誤ってカバー画像URL（i.scdn.co/...）が入っている行を検出し、正しいアルバムURLに修復します。
          </p>
          {repairResult && (
            <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
              <p style={{ color: "#4ade80" }}>
                {repairResult.message ?? `完了 — 対象: ${repairResult.total} / 修復: ${repairResult.fixed} / 失敗: ${repairResult.failed}`}
              </p>
            </div>
          )}
          {repairError && <p className="text-red-400 text-xs mb-3">{repairError}</p>}
          <button onClick={handleRepairSpotify} disabled={repairLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            {repairLoading ? "実行中..." : "実行"}
          </button>
        </div>

        {/* sync-scores-to-rm */}
        <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>スコア → Release Master 書き戻し</h3>
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            scoresシートのスコアをRelease Masterのメンバー列に書き戻します。デフォルトは空セルのみ書き込み。
          </p>
          <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={syncForce} onChange={e => setSyncForce(e.target.checked)} className="rounded" />
            上書きあり（既存値も更新）
          </label>
          {syncResult && (
            <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
              <p style={{ color: "#4ade80" }}>完了 — 書き込み: {syncResult.written} / スキップ: {syncResult.skipped} / RM未発見: {syncResult.notFound}</p>
            </div>
          )}
          {syncError && <p className="text-red-400 text-xs mb-3">{syncError}</p>}
          <button onClick={handleSyncScoresToRm} disabled={syncLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
            {syncLoading ? "実行中..." : "実行"}
          </button>
        </div>

      </div>
    </div>
  );
}
