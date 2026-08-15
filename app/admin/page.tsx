"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

type Step = "auth" | "main";
type TabKey = "weekly" | "monthly" | "maintenance";

// 区分ごとのアクセントカラー（タブ・枠線・ボタン共通）
const SECTION = {
  weekly:      { border: "rgba(59,130,246,0.35)",  accent: "#60a5fa" },
  monthly:     { border: "rgba(139,92,246,0.35)",  accent: "var(--accent)" },
  maintenance: { border: "var(--border-subtle)",   accent: "var(--text-secondary)" },
} as const;

const TABS: { key: TabKey; label: string; description: string; color: string }[] = [
  { key: "weekly", label: "週次リリース処理", description: "毎週リリース後、上から順に実行してください", color: SECTION.weekly.accent },
  { key: "monthly", label: "月次設定", description: "月替わりのタイミングで確認・更新するもの", color: SECTION.monthly.accent },
  { key: "maintenance", label: "保守・トラブルシューティング", description: "普段は触らなくてOK。問題が起きた時だけ使う", color: SECTION.maintenance.accent },
];

type SpotifyCandidate = { id: string; name: string; artist: string; coverUrl: string; releaseDate: string; albumType: string; spotifyUrl: string };

const ALBUM_TYPE_LABEL: Record<string, string> = { album: "アルバム", single: "シングル/EP", compilation: "コンピレーション" };

type RefetchMismatch = {
  rowNum: number; sheetTitle: string; sheetArtist: string; sheetDate: string; sheetGenre: string;
  spotifyTitle: string; spotifyArtist: string; spotifyUrl: string;
};

/** 洋邦から期待されるSpotify album_typeを返す（不明ならnull） */
function expectedAlbumTypes(genre: string): string[] | null {
  if (genre === "洋楽") return ["album"];
  if (genre === "邦楽") return ["album", "single"];
  return null;
}

function matchColors(match: boolean | null) {
  if (match === true) return { bg: "rgba(34,197,94,0.15)", fg: "#4ade80", border: "rgba(34,197,94,0.4)" };
  if (match === false) return { bg: "rgba(251,191,36,0.15)", fg: "#fbbf24", border: "var(--border-subtle)" };
  return { bg: "rgba(255,255,255,0.08)", fg: "var(--text-secondary)", border: "var(--border-subtle)" };
}

function MismatchQueueModal({ mismatches, password, onClose }: { mismatches: RefetchMismatch[]; password: string; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [statuses, setStatuses] = useState<Record<number, "resolved" | "deleted">>({});
  const [candidatesByRow, setCandidatesByRow] = useState<Record<number, SpotifyCandidate[]>>({});
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = mismatches[index];
  const currentStatus = statuses[current.rowNum];
  const candidates = candidatesByRow[current.rowNum];
  const expected = expectedAlbumTypes(current.sheetGenre);
  const resolvedCount = Object.keys(statuses).length;

  useEffect(() => {
    if (candidatesByRow[current.rowNum]) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/spotify/search?q=${encodeURIComponent(`${current.sheetArtist} ${current.sheetTitle}`)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setCandidatesByRow((prev) => ({ ...prev, [current.rowNum]: data })); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.rowNum]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function goToNextPending() {
    for (let step = 1; step <= mismatches.length; step++) {
      const next = (index + step) % mismatches.length;
      if (!statuses[mismatches[next].rowNum]) { setIndex(next); return; }
    }
  }

  async function choose(c: SpotifyCandidate) {
    setResolvingId(c.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/resolve-spotify-mismatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, rowNum: current.rowNum, spotifyUrl: c.spotifyUrl, coverUrl: c.coverUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      setStatuses((prev) => ({ ...prev, [current.rowNum]: "resolved" }));
      goToNextPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setResolvingId(null);
    }
  }

  async function deleteRow() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/clear-release-master-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, rowNum: current.rowNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "削除に失敗しました");
      setStatuses((prev) => ({ ...prev, [current.rowNum]: "deleted" }));
      goToNextPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setDeleting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-5" style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={() => { setError(null); setIndex((i) => (i - 1 + mismatches.length) % mismatches.length); }}
              className="w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>‹</button>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>MISMATCH {index + 1} / {mismatches.length}件（解消済み {resolvedCount}）</span>
            <button onClick={() => { setError(null); setIndex((i) => (i + 1) % mismatches.length); }}
              className="w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>›</button>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-lg" style={{ color: "var(--text-secondary)" }} aria-label="閉じる">✕</button>
        </div>

        {currentStatus && (
          <div className="rounded-xl p-2 mb-3 text-xs text-center" style={{
            backgroundColor: currentStatus === "resolved" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
            color: currentStatus === "resolved" ? "#4ade80" : "#f87171",
          }}>
            {currentStatus === "resolved" ? "✓ 補完済みです" : "✓ Release Masterから削除済みです"}
          </div>
        )}

        <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: "var(--bg-card)" }}>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Release Masterの登録情報（行{current.rowNum}）</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p style={{ color: "var(--text-secondary)" }}>日付</p>
              <p style={{ color: "var(--text-primary)" }}>{current.sheetDate || "—"}</p>
            </div>
            <div>
              <p style={{ color: "var(--text-secondary)" }}>洋邦</p>
              <p style={{ color: "var(--text-primary)" }}>
                {current.sheetGenre || "—"}
                {expected && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#60a5fa" }}>
                    {expected.includes("single") ? "アルバム/EP想定" : "アルバム想定"}
                  </span>
                )}
              </p>
            </div>
            <div className="col-span-2">
              <p style={{ color: "var(--text-secondary)" }}>タイトル / アーティスト</p>
              <p style={{ color: "var(--text-primary)" }}>{current.sheetArtist} / {current.sheetTitle}</p>
            </div>
          </div>
        </div>

        <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Spotify候補</p>
        {loading && <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>検索中...</p>}
        <div className="flex flex-col gap-1.5 mb-3">
          {candidates?.map((c) => {
            const match = expected ? expected.includes(c.albumType) : null;
            const mc = matchColors(match);
            return (
              <div key={c.id} className="flex items-center gap-2 rounded-lg p-2 border" style={{ borderColor: mc.border, backgroundColor: "rgba(255,255,255,0.03)" }}>
                {c.coverUrl && <Image src={c.coverUrl} alt="" width={40} height={40} className="rounded flex-shrink-0 object-cover" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{c.name}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{c.artist} ・ {c.releaseDate || "日付不明"}</p>
                </div>
                <span className="text-xs px-2 py-1 rounded flex-shrink-0" style={{ backgroundColor: mc.bg, color: mc.fg }}>
                  {ALBUM_TYPE_LABEL[c.albumType] ?? c.albumType}
                </span>
                <button onClick={() => choose(c)} disabled={resolvingId !== null || deleting}
                  className="text-xs px-2 py-1.5 rounded-lg border disabled:opacity-50 flex-shrink-0"
                  style={{ borderColor: "#60a5fa", color: "#60a5fa" }}>
                  {resolvingId === c.id ? "保存中..." : "これに決定"}
                </button>
              </div>
            );
          })}
          {candidates && candidates.length === 0 && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>候補が見つかりませんでした</p>
          )}
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>候補に正解がない場合</p>
          <button onClick={deleteRow} disabled={deleting || resolvingId !== null}
            className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-50 flex-shrink-0"
            style={{ borderColor: "rgba(239,68,68,0.4)", color: "#f87171" }}>
            {deleting ? "削除中..." : "この行をRelease Masterから削除"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AdminPage() {
  const [step, setStep] = useState<Step>("auth");
  const [tab, setTab] = useState<TabKey>("weekly");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Bulk import
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; pendingCleared: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // fill-time-tracks
  type FillDetail = { row: number; artist: string; title: string; result: string };
  type FillResult = { ok: number; skipNotFound: number; skipNoUrl: number; total: number; details: FillDetail[]; dryRun: boolean };
  const [fillLoading, setFillLoading] = useState(false);
  const [fillResult, setFillResult] = useState<FillResult | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);
  const [fillDryRun, setFillDryRun] = useState(true);
  const [fillLimit, setFillLimit] = useState(15);

  // assign-uids
  type AssignUidsDetail = { row: number; no: string; title: string; artist: string };
  type AssignUidsApiResult = {
    total: number; assigned: number; skippedHasUid: number; skippedEmpty: number; skippedNoSpotifyUrl: number;
    assignedDetails: AssignUidsDetail[]; pendingDetails: AssignUidsDetail[]; dryRun: boolean;
  };
  const [assignUidsLoading, setAssignUidsLoading] = useState(false);
  const [assignUidsResult, setAssignUidsResult] = useState<AssignUidsApiResult | null>(null);
  const [assignUidsError, setAssignUidsError] = useState<string | null>(null);
  const [assignUidsDryRun, setAssignUidsDryRun] = useState(true);

  // backfill-album-uids
  type BackfillSheetResult = {
    sheet: string; skipped: boolean; skipReason?: string;
    total: number; exactHit: number; lowerHit: number; alreadySet: number; emptyRow: number; unmatched: string[];
  };
  type BackfillApiResult = {
    rmAlbumRows: number; rmUidMapSize: number; rmNoUid: number; duplicateKeys: number;
    sheets: BackfillSheetResult[]; dryRun: boolean;
  };
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillApiResult | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillDryRun, setBackfillDryRun] = useState(true);

  // dedup-scores
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupResult, setDedupResult] = useState<{ total: number; kept: number; cleared: number } | null>(null);
  const [dedupError, setDedupError] = useState<string | null>(null);

  // repair-covers
  const [coversLoading, setCoversLoading] = useState(false);
  const [coversResult, setCoversResult] = useState<{ total: number; fixed: number; failed: number; noChange: number; message?: string } | null>(null);
  const [coversError, setCoversError] = useState<string | null>(null);
  const [coversLimit, setCoversLimit] = useState(20);

  // refetch-spotify（空URL一括取得）
  type RefetchResult = { written: number; mismatched: number; notFound: number; total: number; totalEmpty: number; mismatches: RefetchMismatch[]; message?: string };
  const [refetchLoading, setRefetchLoading] = useState(false);
  const [refetchResult, setRefetchResult] = useState<RefetchResult | null>(null);
  const [refetchError, setRefetchError] = useState<string | null>(null);
  const [refetchLimit, setRefetchLimit] = useState(30);
  const [mismatchModalOpen, setMismatchModalOpen] = useState(false);

  // repair-spotify（誤入力URL修復）
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairResult, setRepairResult] = useState<{ total: number; fixed: number; failed: number; message?: string } | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  // sync-scores-to-rm
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ written: number; notFound: number; skipped: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncForce, setSyncForce] = useState(false);

  // test-spotify
  const [spotifyTestLoading, setSpotifyTestLoading] = useState(false);
  const [spotifyTestResult, setSpotifyTestResult] = useState<Record<string, unknown> | null>(null);
  const [spotifyTestError, setSpotifyTestError] = useState<string | null>(null);

  // default-month setting
  const [defaultMonth, setDefaultMonth] = useState<string>("");
  const [monthOptions, setMonthOptions] = useState<string[]>([]);
  const [defaultMonthSaving, setDefaultMonthSaving] = useState(false);
  const [defaultMonthResult, setDefaultMonthResult] = useState<string | null>(null);
  const [defaultMonthError, setDefaultMonthError] = useState<string | null>(null);

  // UID重複アラート
  type UidDuplicateRow = { row: number; no: string; title: string; artist: string };
  type UidDuplicateGroup = { uid: string; rows: UidDuplicateRow[] };
  const [uidDuplicates, setUidDuplicates] = useState<UidDuplicateGroup[]>([]);
  const [uidDuplicatesChecking, setUidDuplicatesChecking] = useState(false);

  async function checkForUidDuplicates(pw: string) {
    setUidDuplicatesChecking(true);
    try {
      const res = await fetch("/api/admin/uid-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: pw }),
      });
      const data = await res.json();
      if (res.ok) setUidDuplicates(data.duplicates ?? []);
    } catch {
      // 失敗時はバナーを出さないだけにする（致命的ではない）
    } finally {
      setUidDuplicatesChecking(false);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) { setAuthError("パスワードを入力してください"); return; }
    setAuthLoading(true);
    setStep("main");
    setAuthLoading(false);
    // 設定と月一覧を並行取得
    Promise.all([
      fetch("/api/admin/settings").then(r => r.json()).catch(() => ({})),
      fetch("/api/release-master").then(r => r.json()).catch(() => []),
    ]).then(([settings, albums]: [Record<string, string>, Array<{ date: string }>]) => {
      if (settings.default_month) setDefaultMonth(settings.default_month);
      const months = Array.from(new Set(albums.map((a) => {
        const key = a.date?.substring(0, 7) ?? "";
        return key.length === 7 ? key : "";
      }).filter(Boolean))).sort().reverse() as string[];
      setMonthOptions(["すべて", ...months]);
    });
    checkForUidDuplicates(password);
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

  async function handleAssignUids() {
    setAssignUidsLoading(true);
    setAssignUidsError(null);
    setAssignUidsResult(null);
    try {
      const res = await fetch("/api/admin/assign-uids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, dryRun: assignUidsDryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setAssignUidsResult(data);
    } catch (err) {
      setAssignUidsError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setAssignUidsLoading(false);
    }
  }

  async function handleBackfillAlbumUids() {
    setBackfillLoading(true);
    setBackfillError(null);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/admin/backfill-album-uids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, dryRun: backfillDryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setBackfillResult(data);
    } catch (err) {
      setBackfillError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setBackfillLoading(false);
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

  async function handleSaveDefaultMonth() {
    setDefaultMonthSaving(true);
    setDefaultMonthResult(null);
    setDefaultMonthError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, key: "default_month", value: defaultMonth }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      setDefaultMonthResult("保存しました");
    } catch (err) {
      setDefaultMonthError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setDefaultMonthSaving(false);
    }
  }

  async function handleRefetchSpotify() {
    setRefetchLoading(true);
    setRefetchError(null);
    setRefetchResult(null);
    try {
      const res = await fetch("/api/admin/refetch-spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, limit: refetchLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setRefetchResult(data);
    } catch (err) {
      setRefetchError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setRefetchLoading(false);
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

  async function handleSpotifyTest() {
    setSpotifyTestLoading(true);
    setSpotifyTestError(null);
    setSpotifyTestResult(null);
    try {
      const res = await fetch("/api/admin/test-spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "実行に失敗しました");
      setSpotifyTestResult(data);
    } catch (err) {
      setSpotifyTestError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSpotifyTestLoading(false);
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

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>管理者ページ</h1>
        <button
          onClick={() => { setStep("auth"); setPassword(""); }}
          className="text-sm px-4 py-2 rounded-xl border"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          ログアウト
        </button>
      </div>

      {uidDuplicates.length > 0 && (
        <div className="mb-4 rounded-2xl p-4 border" style={{ backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.4)" }}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm font-bold" style={{ color: "#f87171" }}>⚠ Release MasterにUIDの重複が{uidDuplicates.length}件あります</p>
            <button onClick={() => checkForUidDuplicates(password)} disabled={uidDuplicatesChecking}
              className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-50 flex-shrink-0"
              style={{ borderColor: "rgba(239,68,68,0.4)", color: "#f87171" }}>
              {uidDuplicatesChecking ? "確認中..." : "再チェック"}
            </button>
          </div>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            重複が解消されるまで自動UID採番・保守タブの「UID採番」がブロックされます。どちらか一方の行のUIDセルを空にして、保守タブの「UID採番」で再採番してください。
          </p>
          <div className="flex flex-col gap-2">
            {uidDuplicates.map((g) => (
              <div key={g.uid} className="text-xs rounded-lg p-2" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
                <p style={{ color: "var(--text-secondary)" }}>UID: <span className="font-mono">{g.uid}</span></p>
                {g.rows.map((r) => (
                  <p key={r.row} style={{ color: "var(--text-primary)" }}>row{r.row}: [No.{r.no}] {r.artist} - {r.title}</p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* タブ */}
      <div className="flex gap-1 border-b mb-1 overflow-x-auto" style={{ borderColor: "var(--border-subtle)" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors"
            style={{
              color: tab === t.key ? t.color : "var(--text-secondary)",
              borderBottom: `2px solid ${tab === t.key ? t.color : "transparent"}`,
              marginBottom: "-1px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs mb-6" style={{ color: "var(--text-secondary)" }}>{activeTab.description}</p>

      <div className="flex flex-col gap-4">

        {tab === "weekly" && (
          <>
            {/* Spotify URL一括取得 */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.weekly.border }}>
              <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Spotify URL 一括取得</h3>
              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
                Spotify URLが空の行をSpotify APIで検索して書き込みます。アルバム名・アーティスト名が一致しない行はMISMATCHとして表示しスキップします。
              </p>
              <div className="mb-3">
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                  最大
                  <select value={refetchLimit} onChange={e => setRefetchLimit(Number(e.target.value))}
                    className="px-2 py-1 rounded-lg border text-sm"
                    style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>
                    {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}件</option>)}
                  </select>
                  件処理
                </label>
              </div>
              {refetchResult && (
                <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
                  {refetchResult.message ? (
                    <p style={{ color: "#4ade80" }}>{refetchResult.message}</p>
                  ) : (
                    <>
                      <p style={{ color: "#4ade80" }}>
                        完了 — 書き込み: {refetchResult.written}件 / MISMATCH: {refetchResult.mismatched}件 / 見つからず: {refetchResult.notFound}件
                        {refetchResult.totalEmpty > refetchResult.total && (
                          <span style={{ color: "var(--text-secondary)" }}>　（残り空URL: {refetchResult.totalEmpty - refetchResult.total}件）</span>
                        )}
                      </p>
                      {refetchResult.mismatches.length > 0 && (
                        <div className="mt-2">
                          <p className="font-semibold mb-1.5" style={{ color: "#fbbf24" }}>⚠ MISMATCH（手動確認が必要）</p>
                          <div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto mb-2">
                            {refetchResult.mismatches.map((m) => (
                              <span key={m.rowNum} style={{ color: "var(--text-secondary)" }}>行{m.rowNum}: {m.sheetArtist} / {m.sheetTitle}</span>
                            ))}
                          </div>
                          <button onClick={() => setMismatchModalOpen(true)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium border"
                            style={{ borderColor: "#fbbf24", color: "#fbbf24" }}>
                            MISMATCHを解消する（{refetchResult.mismatches.length}件）
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {refetchError && <p className="text-red-400 text-xs mb-3">{refetchError}</p>}
              <button onClick={handleRefetchSpotify} disabled={refetchLoading}
                className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
                style={{ borderColor: SECTION.weekly.accent, color: SECTION.weekly.accent }}>
                {refetchLoading ? "取得中..." : "実行"}
              </button>
              {mismatchModalOpen && refetchResult && refetchResult.mismatches.length > 0 && (
                <MismatchQueueModal
                  mismatches={refetchResult.mismatches}
                  password={password}
                  onClose={() => setMismatchModalOpen(false)}
                />
              )}
            </div>

            {/* repair-covers */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.weekly.border }}>
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
                style={{ borderColor: SECTION.weekly.accent, color: SECTION.weekly.accent }}>
                {coversLoading ? "実行中..." : "実行"}
              </button>
            </div>

            {/* fill-time-tracks */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.weekly.border }}>
              <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Time・曲数補完</h3>
              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
                Time列が空でSpotify URLが既に登録済みのアルバムのみ、そのURLを正として時間・曲数を補完します。URLがない行は検索せず対象外（シングル/同名EPの誤登録防止）。
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
                    {fillResult.dryRun ? "Dry-run 完了" : "書き込み完了"} — {fillResult.total}件対象 / {fillResult.ok}件成功 / {fillResult.skipNotFound}件取得失敗 / {fillResult.skipNoUrl}件対象外（URLなし）
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
                style={{ borderColor: SECTION.weekly.accent, color: SECTION.weekly.accent }}>
                {fillLoading ? "実行中..." : "実行"}
              </button>
            </div>

            {/* Bulk import */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.weekly.border }}>
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
                style={{ borderColor: SECTION.weekly.accent, color: SECTION.weekly.accent }}>
                {importLoading ? "取り込み中..." : "実行"}
              </button>
            </div>
          </>
        )}

        {tab === "monthly" && (
          <>
            {/* デフォルト月フィルター */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.monthly.border }}>
              <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>ホームのデフォルト月フィルター</h3>
              <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
                ユーザーが初めてアクセスしたとき（または月フィルターを保存していない場合）に表示する月を設定します。
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={defaultMonth}
                  onChange={(e) => setDefaultMonth(e.target.value)}
                  className="px-3 py-2 rounded-xl border text-sm focus:outline-none"
                  style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)", minWidth: "140px" }}
                >
                  {monthOptions.length === 0 && <option value="">読み込み中...</option>}
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>{m === "すべて" ? "すべて" : m.replace("/", "年").replace(/^(\d+年)0?(\d+)$/, "$1$2月")}</option>
                  ))}
                </select>
                <button
                  onClick={handleSaveDefaultMonth}
                  disabled={defaultMonthSaving || !defaultMonth}
                  className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
                  style={{ borderColor: SECTION.monthly.accent, color: SECTION.monthly.accent }}
                >
                  {defaultMonthSaving ? "保存中..." : "保存"}
                </button>
              </div>
              {defaultMonthResult && <p className="text-xs mt-2" style={{ color: "#4ade80" }}>{defaultMonthResult}</p>}
              {defaultMonthError && <p className="text-xs mt-2 text-red-400">{defaultMonthError}</p>}
            </div>
          </>
        )}

        {tab === "maintenance" && (
          <>
            {/* assign-uids */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.maintenance.border }}>
              <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>UID採番（Release Master）</h3>
              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
                各行に安定ID（UID）を採番します。Spotify URLが確認できた行（＝内容確定済み）のみ対象。通常はページ訪問のたびに自動実行されるので、今すぐ反映したい時やトラブル時の手動実行用です。
              </p>
              <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={assignUidsDryRun} onChange={e => setAssignUidsDryRun(e.target.checked)} className="rounded" />
                Dry-run（書き込みなし）
              </label>
              {assignUidsResult && (
                <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: assignUidsResult.dryRun ? "rgba(99,102,241,0.1)" : "rgba(34,197,94,0.1)", borderColor: assignUidsResult.dryRun ? "rgba(99,102,241,0.3)" : "rgba(34,197,94,0.3)" }}>
                  <p className="font-medium mb-1" style={{ color: assignUidsResult.dryRun ? "#a5b4fc" : "#4ade80" }}>
                    {assignUidsResult.dryRun ? "Dry-run 完了" : "採番完了"} — {assignUidsResult.total}件対象 / 新規採番 {assignUidsResult.assigned}件 / 採番済み {assignUidsResult.skippedHasUid}件 / URL未確定でスキップ {assignUidsResult.skippedNoSpotifyUrl}件
                  </p>
                  {assignUidsResult.pendingDetails.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1">
                      <p className="font-semibold" style={{ color: "#fbbf24" }}>⚠ URL未確定（Spotify URL取得後に再実行してください）</p>
                      <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                        {assignUidsResult.pendingDetails.map((d) => (
                          <span key={d.row} style={{ color: "var(--text-secondary)" }}>row{d.row}: [{d.no}] {d.artist} - {d.title}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {assignUidsError && <p className="text-red-400 text-xs mb-3">{assignUidsError}</p>}
              <button onClick={handleAssignUids} disabled={assignUidsLoading}
                className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
                style={{ borderColor: SECTION.maintenance.accent, color: SECTION.maintenance.accent }}>
                {assignUidsLoading ? "実行中..." : "実行"}
              </button>
            </div>

            {/* backfill-album-uids */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.maintenance.border }}>
              <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>アルバムUID紐付け</h3>
              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
                scores・bookmarks・recommendationsの各行を、Release MasterのUID（タイトル+アーティスト一致）に紐付けます。通常は自動実行されるので、今すぐ反映したい時やトラブル時の手動実行用です（UID採番の後に実行してください）。
              </p>
              <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={backfillDryRun} onChange={e => setBackfillDryRun(e.target.checked)} className="rounded" />
                Dry-run（書き込みなし）
              </label>
              {backfillResult && (
                <div className="rounded-xl p-3 mb-3 border text-xs" style={{ backgroundColor: backfillResult.dryRun ? "rgba(99,102,241,0.1)" : "rgba(34,197,94,0.1)", borderColor: backfillResult.dryRun ? "rgba(99,102,241,0.3)" : "rgba(34,197,94,0.3)" }}>
                  <p className="font-medium mb-1" style={{ color: backfillResult.dryRun ? "#a5b4fc" : "#4ade80" }}>
                    {backfillResult.dryRun ? "Dry-run 完了" : "紐付け完了"} — RM UIDマップ {backfillResult.rmUidMapSize}件（未採番 {backfillResult.rmNoUid}件）
                  </p>
                  <div className="flex flex-col gap-2 mt-2">
                    {backfillResult.sheets.map((s) => (
                      <div key={s.sheet}>
                        <p className="font-medium" style={{ color: "var(--text-primary)" }}>{s.sheet}</p>
                        {s.skipped ? (
                          <p style={{ color: "var(--text-secondary)" }}>{s.skipReason}</p>
                        ) : (
                          <>
                            <p style={{ color: "var(--text-secondary)" }}>
                              完全一致 {s.exactHit} / 緩和一致 {s.lowerHit} / 設定済み {s.alreadySet} / アンマッチ {s.unmatched.length}
                            </p>
                            {s.unmatched.length > 0 && (
                              <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto mt-1">
                                {s.unmatched.map((u, i) => <span key={i} style={{ color: "#fbbf24" }}>{u}</span>)}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {backfillError && <p className="text-red-400 text-xs mb-3">{backfillError}</p>}
              <button onClick={handleBackfillAlbumUids} disabled={backfillLoading}
                className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
                style={{ borderColor: SECTION.maintenance.accent, color: SECTION.maintenance.accent }}>
                {backfillLoading ? "実行中..." : "実行"}
              </button>
            </div>

            {/* dedup-scores */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.maintenance.border }}>
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
                style={{ borderColor: SECTION.maintenance.accent, color: SECTION.maintenance.accent }}>
                {dedupLoading ? "実行中..." : "実行"}
              </button>
            </div>

            {/* repair-spotify */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.maintenance.border }}>
              <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Spotify 誤入力URL修復</h3>
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
                style={{ borderColor: SECTION.maintenance.accent, color: SECTION.maintenance.accent }}>
                {repairLoading ? "実行中..." : "実行"}
              </button>
            </div>

            {/* Spotify診断 */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.maintenance.border }}>
              <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Spotify 認証診断</h3>
              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
                SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET の設定確認と、実際のAPIアクセスをテストします。
              </p>
              {spotifyTestResult && (
                <div className="rounded-xl p-3 mb-3 border text-xs font-mono" style={{ backgroundColor: "rgba(0,0,0,0.3)", borderColor: "var(--border-subtle)", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {JSON.stringify(spotifyTestResult, null, 2)}
                </div>
              )}
              {spotifyTestError && <p className="text-red-400 text-xs mb-3">{spotifyTestError}</p>}
              <button onClick={handleSpotifyTest} disabled={spotifyTestLoading}
                className="px-4 py-2 rounded-xl text-sm font-medium border disabled:opacity-50"
                style={{ borderColor: SECTION.maintenance.accent, color: SECTION.maintenance.accent }}>
                {spotifyTestLoading ? "テスト中..." : "診断を実行"}
              </button>
            </div>

            {/* sync-scores-to-rm */}
            <div className="rounded-2xl p-5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: SECTION.maintenance.border }}>
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
                style={{ borderColor: SECTION.maintenance.accent, color: SECTION.maintenance.accent }}>
                {syncLoading ? "実行中..." : "実行"}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
