"use client";

/**
 * Spotify URL 一括取得で名前が一致しなかった行（MISMATCH）を1件ずつ解消するモーダル。
 * 管理画面（/admin）と週次作業ページ（/weekly）で共用する。
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

type SpotifyCandidate = { id: string; name: string; artist: string; coverUrl: string; releaseDate: string; albumType: string; spotifyUrl: string };

const ALBUM_TYPE_LABEL: Record<string, string> = { album: "アルバム", single: "シングル/EP", compilation: "コンピレーション" };

export type RefetchMismatch = {
  rowNum: number; sheetTitle: string; sheetArtist: string; sheetDate: string; sheetGenre: string;
  sheetMemo: string; reviewers: string[];
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

export function MismatchQueueModal({ mismatches, onClose }: { mismatches: RefetchMismatch[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [statuses, setStatuses] = useState<Record<number, "resolved" | "deleted">>({});
  const [candidatesByRow, setCandidatesByRow] = useState<Record<number, SpotifyCandidate[]>>({});
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [savingManualUrl, setSavingManualUrl] = useState(false);

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
        body: JSON.stringify({ rowNum: current.rowNum, spotifyUrl: c.spotifyUrl, coverUrl: c.coverUrl }),
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

  async function saveManualUrl() {
    const url = manualUrl.trim();
    if (!url) return;
    setSavingManualUrl(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/resolve-spotify-mismatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNum: current.rowNum, spotifyUrl: url, coverUrl: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存に失敗しました");
      setStatuses((prev) => ({ ...prev, [current.rowNum]: "resolved" }));
      setManualUrl("");
      goToNextPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSavingManualUrl(false);
    }
  }

  async function deleteRow() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/clear-release-master-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNum: current.rowNum }),
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
            <button onClick={() => { setError(null); setManualUrl(""); setIndex((i) => (i - 1 + mismatches.length) % mismatches.length); }}
              className="w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>‹</button>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>MISMATCH {index + 1} / {mismatches.length}件（解消済み {resolvedCount}）</span>
            <button onClick={() => { setError(null); setManualUrl(""); setIndex((i) => (i + 1) % mismatches.length); }}
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
            <div className="col-span-2">
              <p style={{ color: "var(--text-secondary)" }}>genre</p>
              <p style={{ color: current.sheetMemo ? "#fbbf24" : "var(--text-secondary)" }}>
                {current.sheetMemo || "記載なし"}
              </p>
            </div>
            <div className="col-span-2">
              <p style={{ color: "var(--text-secondary)" }}>レビュー</p>
              <p style={{ color: current.reviewers.length > 0 ? "#fbbf24" : "var(--text-secondary)" }}>
                {current.reviewers.length > 0 ? `${current.reviewers.join("、")} がレビュー済み` : "レビューなし"}
              </p>
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

        <div className="border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>候補に正解がない場合（Spotifyに無いアルバムなど）</p>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="Bandcampなどのリンクを貼り付け"
              className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border text-xs focus:outline-none"
              style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            />
            <button onClick={saveManualUrl} disabled={savingManualUrl || !manualUrl.trim() || deleting}
              className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-50 flex-shrink-0"
              style={{ borderColor: "#60a5fa", color: "#60a5fa" }}>
              {savingManualUrl ? "保存中..." : "このリンクで確定"}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>本当に登録ミスなら</p>
            <button onClick={deleteRow} disabled={deleting || resolvingId !== null || savingManualUrl}
              className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-50 flex-shrink-0"
              style={{ borderColor: "rgba(239,68,68,0.4)", color: "#f87171" }}>
              {deleting ? "削除中..." : "この行をRelease Masterから削除"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
