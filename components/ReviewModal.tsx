"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { useSession, signIn } from "next-auth/react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { Recommendation } from "@/lib/sheets";
import ScoreBar from "@/components/ScoreBar";
import { EMAIL_TO_SHORT_NAME, LEGACY_NAME_TO_EMAIL, getDisplayName, parseLegacyScoreNum } from "@/lib/members";

const ALL_MEMBERS: { email: string; name: string }[] = Object.entries(EMAIL_TO_SHORT_NAME).map(([email, name]) => ({ email, name }));

// スライダーのなしゾーン幅。小さくするほど「なし」と「0」が近くなる (-3〜0 の間で調整)
const NOSCORE_MIN = -1.4;

function parseLegacyScore(value: string): { score: number | null; comment: string } {
  const trimmed = value.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    const num = parseFloat(trimmed);
    return { score: isNaN(num) ? null : num, comment: "" };
  }
  const num = parseFloat(trimmed.substring(0, spaceIdx));
  return { score: isNaN(num) ? null : num, comment: trimmed.substring(spaceIdx + 1).trim() };
}

interface ReviewModalProps {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  spotifyUrl?: string;
  onClose: () => void;
}

function getScoreColor(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#eab308";
  return "#ef4444";
}

export default function ReviewModal({ album, coverUrl, spotifyUrl, onClose }: ReviewModalProps) {
  const { data: session, status } = useSession();
  const [scores, setScores] = useState<Score[]>([]);
  const [averageScore, setAverageScore] = useState<number | null>(null);
  const [loadingScores, setLoadingScores] = useState(true);

  const [rawSlider, setRawSlider] = useState<number>(NOSCORE_MIN);
  const isNoScore = rawSlider < 0;
  const score: number | null = isNoScore ? null : Math.round(Math.max(0, rawSlider) * 2) / 2;
  function snapSlider(val: number) {
    if (val < 0) {
      const ratio = (val - NOSCORE_MIN) / (0 - NOSCORE_MIN);
      setRawSlider(ratio >= 0.3 ? 0 : NOSCORE_MIN);
    } else {
      setRawSlider(Math.round(val * 2) / 2);
    }
  }
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendMessage, setRecommendMessage] = useState("");
  const [mentionedEmails, setMentionedEmails] = useState<string[]>([]);
  const [recommendSubmitting, setRecommendSubmitting] = useState(false);
  const [recommendSuccess, setRecommendSuccess] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [mjAdoption, setMjAdoption] = useState(album.mjAdoption ?? "");
  const [mjPicker, setMjPicker] = useState(false);
  const [mjPending, setMjPending] = useState<string | null>(null);
  const [mjUpdating, setMjUpdating] = useState(false);
  const [albumRecs, setAlbumRecs] = useState<Recommendation[]>([]);

  useEffect(() => {
    fetch(`/api/recommendations?albumNo=${encodeURIComponent(album.no)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((recs: Recommendation[]) =>
        setAlbumRecs(recs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
      );
  }, [album.no]);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/bookmarks")
        .then((r) => r.ok ? r.json() : [])
        .then((bms: { albumTitle: string; artistName: string }[]) =>
          setBookmarked(bms.some((b) => b.albumTitle === album.title && b.artistName === album.artist))
        );
    }
  }, [status, album.title, album.artist]);

  async function toggleBookmark() {
    setBookmarkLoading(true);
    try {
      const body = JSON.stringify({ albumTitle: album.title, artistName: album.artist });
      if (bookmarked) {
        await fetch("/api/bookmarks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body });
        setBookmarked(false);
      } else {
        await fetch("/api/bookmarks", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        setBookmarked(true);
      }
    } finally {
      setBookmarkLoading(false);
    }
  }

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch(`/api/scores/${album.no}`);
      if (res.ok) {
        const data = await res.json();
        setScores(data.scores || []);
        setAverageScore(data.averageScore ?? null);
      }
    } finally {
      setLoadingScores(false);
    }
  }, [album.no]);

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll (iOS Safari compatible)
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.cssText = `position: fixed; top: -${scrollY}px; width: 100%; overflow-y: scroll;`;
    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/scores/${album.no}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim(), albumTitle: album.title, artistName: album.artist }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "投稿に失敗しました");
      setSubmitSuccess(true);
      setRawSlider(NOSCORE_MIN);
      setComment("");
      setIsEditing(false);
      await fetchScores();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/scores/${album.no}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim(), albumTitle: album.title, artistName: album.artist }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新に失敗しました");
      setSubmitSuccess(true);
      setIsEditing(false);
      await fetchScores();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  const myEmail = session?.user?.email?.toLowerCase() ?? null;
  const myShortName = myEmail ? (EMAIL_TO_SHORT_NAME[myEmail] ?? session?.user?.name ?? null) : null;
  // emailが正規識別子。旧エントリ(短縮名)も照合
  const myScore = myEmail
    ? scores.find((s) => {
        const n = s.memberName.toLowerCase();
        return n === myEmail || (myShortName ? n === myShortName.toLowerCase() : false);
      })
    : undefined;
  const alreadyReviewed = !!myScore;
  const myLegacyScore = myShortName && !alreadyReviewed
    ? album.legacyScores.find((s) => s.name === myShortName)
    : undefined;

  function startEditingFromLegacy() {
    if (myLegacyScore) {
      const parsed = parseLegacyScore(myLegacyScore.value);
      setRawSlider(parsed.score !== null ? parsed.score : NOSCORE_MIN);
      setComment(parsed.comment);
    }
    setSubmitSuccess(false);
    setSubmitError(null);
    document.getElementById("review-form-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handleRecommend() {
    setRecommendSubmitting(true);
    setRecommendError(null);
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          albumNo: album.no,
          albumTitle: album.title,
          artistName: album.artist,
          coverUrl: coverUrl || "",
          message: recommendMessage.trim(),
          mentionedEmails,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "レコメンドに失敗しました");
      setRecommendSuccess(true);
      setIsRecommending(false);
      setRecommendMessage("");
      setMentionedEmails([]);
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setRecommendSubmitting(false);
    }
  }

  const MJ_VALUES = ["J採用", "J掲載", "採用", "掲載", "検討", "不採用", ""];

  async function confirmMjUpdate() {
    if (mjPending === null) return;
    setMjUpdating(true);
    try {
      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mjAdoption: mjPending }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "更新失敗");
      setMjAdoption(mjPending);
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setMjUpdating(false);
      setMjPending(null);
      setMjPicker(false);
    }
  }

  function startEditing() {
    if (myScore) {
      setRawSlider(myScore.score !== null ? myScore.score : NOSCORE_MIN);
      setComment(myScore.comment || "");
    }
    setSubmitSuccess(false);
    setSubmitError(null);
    setIsEditing(true);
  }

  // 統合平均: Release Masterスコア優先。同一メンバーは Release Master を使う。
  const legacyCoveredIds = new Set<string>();
  const legacyScoreValues: number[] = [];
  for (const ls of album.legacyScores) {
    const n = parseLegacyScoreNum(ls.value);
    if (n !== null && n >= 0 && n <= 10) {
      legacyScoreValues.push(n);
      const email = LEGACY_NAME_TO_EMAIL[ls.name.toLowerCase()];
      if (email) legacyCoveredIds.add(email);
      legacyCoveredIds.add(ls.name.toLowerCase());
    }
  }
  const appOnlyScoreValues = scores
    .filter((s) => !legacyCoveredIds.has(s.memberName.toLowerCase()) && s.score !== null)
    .map((s) => s.score as number);

  const allScoreValues = [...legacyScoreValues, ...appOnlyScoreValues];
  const combinedAverage = allScoreValues.length > 0
    ? Math.round((allScoreValues.reduce((a, b) => a + b, 0) / allScoreValues.length) * 10) / 10
    : null;
  const combinedCount = allScoreValues.length;

  const scoreColor = combinedAverage !== null ? getScoreColor(combinedAverage) : "#6b7280";

  const touchStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const CLOSE_THRESHOLD = 120;

  function handleHeaderTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }

  function handleHeaderTouchMove(e: React.TouchEvent) {
    if (touchStartY.current === null) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) setDragY(delta);
  }

  function handleHeaderTouchEnd() {
    if (dragY >= CLOSE_THRESHOLD) {
      onClose();
    } else {
      setDragY(0);
    }
    setIsDragging(false);
    touchStartY.current = null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border-subtle)",
          transform: `translateY(${dragY}px)`,
          transition: isDragging ? "none" : "transform 0.3s ease",
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b relative"
          style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)", touchAction: "none" }}
          onTouchStart={handleHeaderTouchStart}
          onTouchMove={handleHeaderTouchMove}
          onTouchEnd={handleHeaderTouchEnd}
        >
          {/* Drag indicator */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
          {/* Left: bookmark */}
          {status === "authenticated" ? (
            <button
              onClick={toggleBookmark}
              disabled={bookmarkLoading}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 disabled:opacity-50"
              style={{ color: bookmarked ? "#eab308" : "var(--text-secondary)" }}
              title={bookmarked ? "保存済み" : "気になるリストに保存"}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          ) : (
            <div className="w-10 h-10" />
          )}
          {/* Right: close */}
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 text-lg font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Album info */}
          <div className="flex gap-4 items-start">
            <div className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
              {coverUrl ? (
                <Image src={coverUrl} alt={album.title} fill sizes="80px" className="object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
              <p className="text-sm mt-0.5 truncate" style={{ color: "var(--accent)" }}>{album.artist}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
                {album.genre && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>{album.genre}</span>
                )}
                <button
                  onClick={() => status === "authenticated" && setMjPicker((v) => !v)}
                  className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-opacity"
                  style={{
                    backgroundColor: mjAdoption && !mjAdoption.includes("不採用") ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
                    color: mjAdoption && !mjAdoption.includes("不採用") ? "var(--accent)" : "var(--text-secondary)",
                    cursor: status === "authenticated" ? "pointer" : "default",
                  }}
                >
                  {mjAdoption || "空欄"}
                  {status === "authenticated" && <span style={{ fontSize: "10px", opacity: 0.6 }}>✎</span>}
                </button>
              </div>
              {spotifyUrl && (
                <a href={spotifyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full text-xs font-medium hover:opacity-80 transition-opacity" style={{ backgroundColor: "#1db954", color: "white" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                  </svg>
                  Spotifyで聴く
                </a>
              )}
            </div>
          </div>

          {/* Average score */}
          {combinedAverage !== null && (
            <div className="rounded-2xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>平均スコア（{combinedCount}件）</span>
                <span className="text-3xl font-bold" style={{ color: scoreColor }}>
                  {combinedAverage.toFixed(1)}
                  <span className="text-sm font-normal ml-1" style={{ color: "var(--text-secondary)" }}>/10</span>
                </span>
              </div>
              <ScoreBar score={combinedAverage} showNumber={false} height="h-2" />
            </div>
          )}

          {/* Member scores */}
          {!loadingScores && scores.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>メンバーのレビュー</h3>
              <div className="flex flex-col gap-3">
                {scores.map((s, i) => (
                  <div key={i} className="rounded-xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                          {getDisplayName(s.memberName).charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{getDisplayName(s.memberName)}</span>
                      </div>
                      {s.score !== null && (
                        <span className="font-bold text-base px-2 py-0.5 rounded-lg" style={{ color: getScoreColor(s.score), backgroundColor: `${getScoreColor(s.score)}18` }}>
                          {s.score % 1 === 0 ? s.score.toFixed(1) : s.score}
                        </span>
                      )}
                    </div>
                    {s.score !== null && <ScoreBar score={s.score} showNumber={false} height="h-1.5" />}
                    {s.comment && <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{s.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Release Master 速報：scoresに取り込まれていない分のみ表示 */}
          {(() => {
            const appScoredIds = new Set(scores.map((s) => s.memberName.toLowerCase()));
            const pending = album.legacyScores.filter((ls) => {
              const email = LEGACY_NAME_TO_EMAIL[ls.name.toLowerCase()];
              if (email && appScoredIds.has(email)) return false;
              if (appScoredIds.has(ls.name.toLowerCase())) return false;
              return ls.value.trim() !== "";
            });
            if (pending.length === 0) return null;
            return (
              <div className="rounded-xl px-3 py-2 border" style={{ borderColor: "var(--border-subtle)", backgroundColor: "rgba(255,255,255,0.03)" }}>
                <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Release Master 速報 · まもなく反映されます</p>
                <div className="flex flex-col gap-1.5">
                  {pending.map((ls) => {
                    const parsed = parseLegacyScore(ls.value);
                    return (
                      <div key={ls.name} className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>{ls.name}</span>
                        {parsed.score !== null && (
                          <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--text-primary)" }}>
                            {parsed.score % 1 === 0 ? parsed.score.toFixed(1) : parsed.score}
                          </span>
                        )}
                        {parsed.comment && (
                          <span className="text-xs" style={{ color: "var(--text-secondary)", opacity: 0.8 }}>{parsed.comment}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Recommend */}
          {status === "authenticated" && (
            <div className="rounded-2xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
              <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>レコメンド</h3>
              {recommendSuccess ? (
                <div className="rounded-xl p-3 border" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
                  <p className="text-green-400 text-sm font-medium">レコメンドしました！</p>
                </div>
              ) : isRecommending ? (
                <div className="flex flex-col gap-3">
                  {/* メンション選択 */}
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>メンション（複数選択可）</p>
                    <div className="flex flex-wrap gap-2">
                      {ALL_MEMBERS
                        .filter((m) => m.email !== myEmail)
                        .map((m) => {
                          const active = mentionedEmails.includes(m.email);
                          return (
                            <button
                              key={m.email}
                              type="button"
                              onClick={() => setMentionedEmails((prev) =>
                                active ? prev.filter((e) => e !== m.email) : [...prev, m.email]
                              )}
                              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                              style={{
                                backgroundColor: active ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.06)",
                                color: active ? "white" : "var(--text-secondary)",
                                border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}`,
                              }}
                            >
                              {active ? "✓ " : ""}{m.name}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                  <textarea
                    value={recommendMessage}
                    onChange={(e) => setRecommendMessage(e.target.value)}
                    placeholder="コメント（任意）"
                    rows={2}
                    className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
                    style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
                  />
                  {recommendError && <p className="text-red-400 text-xs">{recommendError}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setIsRecommending(false); setRecommendError(null); setMentionedEmails([]); }} className="flex-1 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                      キャンセル
                    </button>
                    <button type="button" onClick={handleRecommend} disabled={recommendSubmitting} className="flex-1 py-2 rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "var(--accent)", color: "white" }}>
                      {recommendSubmitting ? "送信中..." : "レコメンドする"}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setIsRecommending(true)} className="w-full py-2.5 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                  このアルバムをレコメンドする
                </button>
              )}
            </div>
          )}

          {/* Recommendations */}
          {albumRecs.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>レコメンド ({albumRecs.length})</h3>
              {albumRecs.map((rec) => (
                <div key={rec.id} className="rounded-xl px-3 py-2.5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                      {getDisplayName(rec.recommenderId).charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{getDisplayName(rec.recommenderId)}</span>
                    {rec.mentionedEmails.length > 0 && (
                      <span className="text-xs flex items-center gap-1 flex-wrap">
                        {rec.mentionedEmails.map((e) => (
                          <span key={e} className="px-1.5 py-0.5 rounded-full text-xs" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                            @{getDisplayName(e)}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>
                      {new Date(rec.createdAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                    </span>
                  </div>
                  {rec.message && (
                    <p className="text-xs mt-1.5 leading-relaxed pl-7" style={{ color: "var(--text-secondary)" }}>
                      &ldquo;{rec.message}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Score submission */}
          <div id="review-form-section" className="rounded-2xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>レビューを投稿</h3>

            {status === "unauthenticated" && (
              <div className="text-center py-4">
                <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>ログインして投稿できます</p>
                <button onClick={() => signIn("google")} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90" style={{ backgroundColor: "white", color: "#1f1f1f" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Googleでログイン
                </button>
              </div>
            )}

            {status === "authenticated" && (
              <>
                <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(139,92,246,0.1)" }}>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>ログイン中：</span>
                  <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>{myShortName ?? session.user?.name}</span>
                </div>

                {alreadyReviewed && !isEditing ? (
                  <div>
                    {submitSuccess && (
                      <div className="rounded-xl p-3 mb-3 border" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
                        <p className="text-green-400 text-sm font-medium">更新しました！</p>
                      </div>
                    )}
                    <div className="rounded-xl p-3 border flex items-center justify-between" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
                      <div>
                        <p className="text-green-400 text-sm font-medium">投稿済みです</p>
                        {myScore && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                            スコア:{" "}
                            {myScore.score !== null
                              ? <span style={{ color: getScoreColor(myScore.score) }}>{myScore.score % 1 === 0 ? myScore.score.toFixed(1) : myScore.score}</span>
                              : <span>—</span>
                            }
                            {myScore.score !== null && " / 10"}
                          </p>
                        )}
                      </div>
                      <button onClick={startEditing} className="px-3 py-1.5 rounded-xl text-xs font-medium border" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                        編集する
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {submitSuccess && !alreadyReviewed && (
                      <div className="rounded-xl p-3 mb-4 border" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
                        <p className="text-green-400 text-sm font-medium">投稿しました！</p>
                      </div>
                    )}
                    <form onSubmit={isEditing ? handleUpdate : handleSubmit} className="flex flex-col gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>スコア</label>
                          {isNoScore ? (
                            <span className="text-sm font-bold" style={{ color: "var(--text-secondary)" }}>スコアなし</span>
                          ) : (
                            <span>
                              <span className="text-2xl font-bold" style={{ color: getScoreColor(score!) }}>
                                {score! % 1 === 0 ? score!.toFixed(1) : score}
                              </span>
                              <span className="text-xs ml-1" style={{ color: "var(--text-secondary)" }}>/10</span>
                            </span>
                          )}
                        </div>
                        {(() => {
                          const SMAX = 10;
                          const totalRange = SMAX - NOSCORE_MIN; // 13
                          const divRatio = (0 - NOSCORE_MIN) / totalRange; // 3/13
                          const curRatio = (rawSlider - NOSCORE_MIN) / totalRange;
                          const fiveRatio = (5 - NOSCORE_MIN) / totalRange; // 8/13
                          const thumbPx = 20;
                          // CSS calc that accounts for thumb radius so "|" aligns with thumb center
                          const divCalc = `calc(${thumbPx / 2}px + (100% - ${thumbPx}px) * ${divRatio.toFixed(6)})`;
                          const fiveCalc = `calc(${thumbPx / 2}px + (100% - ${thumbPx}px) * ${fiveRatio.toFixed(6)})`;
                          const scoreColor = score !== null ? getScoreColor(score) : "#6b7280";
                          const trackBg = isNoScore
                            ? `linear-gradient(to right, #6b7280 0% ${divRatio * 100}%, #2d2d3f ${divRatio * 100}% 100%)`
                            : `linear-gradient(to right, #3b3b50 0% ${divRatio * 100}%, ${scoreColor} ${divRatio * 100}% ${curRatio * 100}%, #2d2d3f ${curRatio * 100}% 100%)`;
                          return (
                            <>
                              <div className="relative">
                                <input
                                  type="range"
                                  min={NOSCORE_MIN}
                                  max={SMAX}
                                  step={0.01}
                                  value={rawSlider}
                                  onChange={(e) => setRawSlider(parseFloat(e.target.value))}
                                  onMouseUp={(e) => snapSlider(parseFloat((e.target as HTMLInputElement).value))}
                                  onTouchEnd={() => snapSlider(rawSlider)}
                                  className="w-full score-slider"
                                  style={{ "--slider-thumb-color": scoreColor, "--slider-track-bg": trackBg } as React.CSSProperties}
                                />
                                <div
                                  className="absolute top-1/2 -translate-y-1/2 w-px h-4 pointer-events-none"
                                  style={{ left: divCalc, backgroundColor: "rgba(255,255,255,0.25)" }}
                                />
                              </div>
                              <div className="relative flex text-xs mt-1.5" style={{ color: "var(--text-secondary)" }}>
                                <span>なし</span>
                                <span className="absolute -translate-x-1/2" style={{ left: divCalc }}>0</span>
                                <span className="absolute -translate-x-1/2" style={{ left: fiveCalc }}>5</span>
                                <span className="ml-auto">10</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>
                          コメント <span style={{ color: "var(--text-secondary)" }}>(任意)</span>
                        </label>
                        <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="感想を書いてください..." rows={3} className="w-full px-3 py-2 rounded-xl border text-sm resize-none" style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }} />
                      </div>
                      {submitError && <p className="text-red-400 text-xs">{submitError}</p>}
                      <div className="flex gap-2">
                        {isEditing && (
                          <button type="button" onClick={() => { setIsEditing(false); setSubmitError(null); }} className="flex-1 py-2.5 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                            キャンセル
                          </button>
                        )}
                        <button type="submit" disabled={submitting} className="flex-1 py-3 rounded-xl font-medium text-sm disabled:opacity-50" style={{ backgroundColor: "var(--accent)", color: "white" }}>
                          {submitting ? (isEditing ? "更新中..." : "投稿中...") : (isEditing ? "更新する" : "投稿する")}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* M/J採用 ピッカー */}
      {mjPicker && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setMjPicker(false)}
        >
          <div
            className="rounded-2xl border p-4 w-full max-w-xs"
            style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>M/J採用を選択</p>
            <div className="flex flex-wrap gap-2">
              {MJ_VALUES.map((v) => (
                <button
                  key={v}
                  onClick={() => { setMjPending(v); setMjPicker(false); }}
                  className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                  style={{
                    backgroundColor: v === mjAdoption ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.08)",
                    color: v === mjAdoption ? "white" : "var(--text-secondary)",
                    border: `1px solid ${v === mjAdoption ? "var(--accent)" : "var(--border-subtle)"}`,
                  }}
                >
                  {v === "" ? "空欄（なし）" : v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* M/J採用 確認ダイアログ */}
      {mjPending !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div className="rounded-2xl p-6 w-full max-w-xs border" style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}>
            <p className="font-bold text-sm mb-1" style={{ color: "var(--text-primary)" }}>M/J採用を変更しますか？</p>
            <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--text-primary)" }}>{mjAdoption || "空欄"}</span>
              {" → "}
              <span style={{ color: "var(--accent)", fontWeight: "600" }}>{mjPending === "" ? "空欄" : mjPending}</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setMjPending(null)}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <button
                onClick={confirmMjUpdate}
                disabled={mjUpdating}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)", color: "white" }}
              >
                {mjUpdating ? "更新中..." : "変更する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
