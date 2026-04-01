"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { useSession, signIn } from "next-auth/react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import ScoreBar from "@/components/ScoreBar";

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

  const [score, setScore] = useState(7.5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendMessage, setRecommendMessage] = useState("");
  const [recommendSubmitting, setRecommendSubmitting] = useState(false);
  const [recommendSuccess, setRecommendSuccess] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);

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

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
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
      setScore(7.5);
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
        body: JSON.stringify({ score, comment: comment.trim() }),
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

  const myScore = session?.user?.name
    ? scores.find((s) => s.memberName === session.user!.name)
    : undefined;
  const alreadyReviewed = !!myScore;

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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "レコメンドに失敗しました");
      setRecommendSuccess(true);
      setIsRecommending(false);
      setRecommendMessage("");
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setRecommendSubmitting(false);
    }
  }

  function startEditing() {
    if (myScore) {
      setScore(myScore.score);
      setComment(myScore.comment || "");
    }
    setSubmitSuccess(false);
    setSubmitError(null);
    setIsEditing(true);
  }

  const scoreColor = averageScore !== null ? getScoreColor(averageScore) : "#6b7280";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b" style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}>
          <div className="w-8 h-1 rounded-full mx-auto sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
          <h2 className="font-bold hidden sm:block" style={{ color: "var(--text-primary)" }}>アルバムレビュー</h2>
          <button onClick={onClose} className="ml-auto w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10" style={{ color: "var(--text-secondary)" }}>
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
                {album.mjAdoption && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                    backgroundColor: album.mjAdoption.includes("採用") && !album.mjAdoption.includes("不採用") ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
                    color: album.mjAdoption.includes("採用") && !album.mjAdoption.includes("不採用") ? "var(--accent)" : "var(--text-secondary)",
                  }}>
                    {album.mjAdoption}
                  </span>
                )}
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
          {averageScore !== null && (
            <div className="rounded-2xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>平均スコア（{scores.length}件）</span>
                <span className="text-3xl font-bold" style={{ color: scoreColor }}>
                  {averageScore.toFixed(1)}
                  <span className="text-sm font-normal ml-1" style={{ color: "var(--text-secondary)" }}>/10</span>
                </span>
              </div>
              <ScoreBar score={averageScore} showNumber={false} height="h-2" />
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
                          {s.memberName.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{s.memberName}</span>
                      </div>
                      <span className="font-bold text-base px-2 py-0.5 rounded-lg" style={{ color: getScoreColor(s.score), backgroundColor: `${getScoreColor(s.score)}18` }}>
                        {s.score % 1 === 0 ? s.score.toFixed(1) : s.score}
                      </span>
                    </div>
                    <ScoreBar score={s.score} showNumber={false} height="h-1.5" />
                    {s.comment && <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{s.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legacy scores from Release Master */}
          {album.legacyScores.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-1" style={{ color: "var(--text-primary)" }}>過去のレビュー</h3>
              <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>Release Masterに記録されたデータです</p>
              <div className="flex flex-col gap-2">
                {album.legacyScores.map((s) => (
                  <div key={s.name} className="flex items-center justify-between px-4 py-2.5 rounded-xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                        {s.name.charAt(0)}
                      </div>
                      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{s.name}</span>
                    </div>
                    <span className="text-sm font-bold" style={{ color: "var(--text-secondary)" }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                  <textarea
                    value={recommendMessage}
                    onChange={(e) => setRecommendMessage(e.target.value)}
                    placeholder="おすすめコメント（任意）"
                    rows={2}
                    className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
                    style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
                  />
                  {recommendError && <p className="text-red-400 text-xs">{recommendError}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setIsRecommending(false); setRecommendError(null); }} className="flex-1 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
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

          {/* Score submission */}
          <div className="rounded-2xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
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
                  <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>{session.user?.name}</span>
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
                            スコア: <span style={{ color: getScoreColor(myScore.score) }}>{myScore.score % 1 === 0 ? myScore.score.toFixed(1) : myScore.score}</span> / 10
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
                        <label className="block text-xs font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                          スコア
                          <span className="ml-2 text-xl font-bold" style={{ color: getScoreColor(score) }}>
                            {score % 1 === 0 ? score.toFixed(1) : score}
                          </span>
                          <span className="text-xs font-normal ml-1" style={{ color: "var(--text-secondary)" }}>/10</span>
                        </label>
                        <input type="range" min={0} max={10} step={0.5} value={score} onChange={(e) => setScore(parseFloat(e.target.value))} className="w-full" style={{ accentColor: getScoreColor(score) }} />
                        <div className="flex justify-between text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                          <span>0</span><span>5</span><span>10</span>
                        </div>
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
    </div>
  );
}
