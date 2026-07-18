"use client";

import { useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { AuthStatus, NOSCORE_MIN, getScoreColor } from "./utils";

interface ReviewFormProps {
  album: ReleaseMasterAlbum;
  status: AuthStatus;
  myScore: Score | undefined;
  alreadyReviewed: boolean;
  myShortName: string | null;
  sessionUserName: string | null | undefined;
  /** 投稿・更新成功後にスコア一覧を再取得する（親の refetchScores） */
  onScoresChanged: () => Promise<void>;
}

/** レビュー投稿カード（ログイン誘導・投稿済み表示・スライダーフォーム） */
export default function ReviewForm({ album, status, myScore, alreadyReviewed, myShortName, sessionUserName, onScoresChanged }: ReviewFormProps) {
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
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/scores/${album.no}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim(), albumTitle: album.title, artistName: album.artist, albumUid: album.uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "投稿に失敗しました");
      setSubmitSuccess(true);
      setRawSlider(NOSCORE_MIN);
      setComment("");
      setIsEditing(false);
      await onScoresChanged();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/scores/${album.no}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim(), albumTitle: album.title, artistName: album.artist, albumUid: album.uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新に失敗しました");
      setSubmitSuccess(true);
      setIsEditing(false);
      await onScoresChanged();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
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

  return (
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
            <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>{myShortName ?? sessionUserName}</span>
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
                  <ScoreSlider rawSlider={rawSlider} score={score} isNoScore={isNoScore} onRawChange={setRawSlider} onSnap={snapSlider} />
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
  );
}

interface ScoreSliderProps {
  rawSlider: number;
  score: number | null;
  isNoScore: boolean;
  onRawChange: (val: number) => void;
  onSnap: (val: number) => void;
}

/** なしゾーン付きスコアスライダー（0.5刻みスナップ・calc()でつまみ位置とグラデーションを一致させる） */
function ScoreSlider({ rawSlider, score, isNoScore, onRawChange, onSnap }: ScoreSliderProps) {
  const SMAX = 10;
  const totalRange = SMAX - NOSCORE_MIN;
  const divRatio = (0 - NOSCORE_MIN) / totalRange;
  const curRatio = (rawSlider - NOSCORE_MIN) / totalRange;
  const fiveRatio = (5 - NOSCORE_MIN) / totalRange;
  const T = 20; // thumb diameter px
  // calc() accounting for thumb radius — same formula used for both gradient stops and overlay positions
  const c = (r: number) => `calc(${T / 2}px + (100% - ${T}px) * ${r.toFixed(6)})`;
  const scoreColor = score !== null ? getScoreColor(score) : "#6b7280";
  // Use calc() in gradient stops so fill aligns exactly with thumb position
  const trackBg = isNoScore
    ? `linear-gradient(to right, #6b7280 0 ${c(divRatio)}, #2d2d3f ${c(divRatio)} 100%)`
    : `linear-gradient(to right, #3b3b50 0 ${c(divRatio)}, ${scoreColor} ${c(divRatio)} ${c(curRatio)}, #2d2d3f ${c(curRatio)} 100%)`;
  return (
    <>
      <div className="relative">
        {/* | divider: placed before input so thumb (input) renders on top and covers it at score=0 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-px h-4 pointer-events-none"
          style={{ left: c(divRatio), backgroundColor: "rgba(255,255,255,0.3)" }}
        />
        <input
          type="range"
          min={NOSCORE_MIN}
          max={SMAX}
          step={0.01}
          value={rawSlider}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            // スコアゾーンは0.5刻みで即スナップ（カクカク感）、なしゾーンは滑らか
            onRawChange(val >= 0 ? Math.round(val * 2) / 2 : val);
          }}
          onMouseUp={(e) => onSnap(parseFloat((e.target as HTMLInputElement).value))}
          onTouchEnd={() => onSnap(rawSlider)}
          className="w-full score-slider"
          style={{ position: "relative", zIndex: 1, "--slider-thumb-color": scoreColor, "--slider-track-bg": trackBg } as React.CSSProperties}
        />
      </div>
      <div className="relative flex text-xs mt-1.5" style={{ color: "var(--text-secondary)" }}>
        <span>なし</span>
        <span className="absolute -translate-x-1/2" style={{ left: c(divRatio) }}>0</span>
        <span className="absolute -translate-x-1/2" style={{ left: c(fiveRatio) }}>5</span>
        <span className="ml-auto">10</span>
      </div>
    </>
  );
}
