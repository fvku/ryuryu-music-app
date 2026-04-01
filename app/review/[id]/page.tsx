"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import ScoreBar from "@/components/ScoreBar";

function getScoreColor(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#eab308";
  return "#ef4444";
}

interface PageProps {
  params: { id: string };
}

export default function ReviewPage({ params }: PageProps) {
  const { data: session, status } = useSession();
  const [album, setAlbum] = useState<ReleaseMasterAlbum | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [averageScore, setAverageScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Spotify fallback cover
  const [displayCoverUrl, setDisplayCoverUrl] = useState<string>("");

  const [score, setScore] = useState(7.5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  async function fetchData() {
    try {
      const [albumRes, scoresRes] = await Promise.all([
        fetch(`/api/release-master/${params.id}`),
        fetch(`/api/scores/${params.id}`),
      ]);

      if (!albumRes.ok) {
        const data = await albumRes.json();
        throw new Error(data.error || "アルバムの取得に失敗しました");
      }

      const albumData: ReleaseMasterAlbum = await albumRes.json();
      setAlbum(albumData);
      setDisplayCoverUrl("");

      if (scoresRes.ok) {
        const scoresData = await scoresRes.json();
        setScores(scoresData.scores || []);
        setAverageScore(scoresData.averageScore ?? null);
      }

      // Spotify fallback for cover art
      if (true) {
        try {
          const spotifyRes = await fetch(
            `/api/spotify/search?q=${encodeURIComponent(`${albumData.artist} ${albumData.title}`)}`
          );
          if (spotifyRes.ok) {
            const spotifyData = await spotifyRes.json();
            if (spotifyData.length > 0 && spotifyData[0].coverUrl) {
              setDisplayCoverUrl(spotifyData[0].coverUrl);
            }
          }
        } catch {
          // ignore Spotify fallback errors
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleSubmitScore(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/scores/${params.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "レビューの投稿に失敗しました");
      setSubmitSuccess(true);
      setScore(7.5);
      setComment("");
      // Refresh scores
      const scoresRes = await fetch(`/api/scores/${params.id}`);
      if (scoresRes.ok) {
        const scoresData = await scoresRes.json();
        setScores(scoresData.scores || []);
        setAverageScore(scoresData.averageScore ?? null);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyReviewed = session?.user?.name
    ? scores.some((s) => s.memberName === session.user!.name)
    : false;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div
          className="w-12 h-12 rounded-full border-4 animate-spin"
          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
        />
        <p style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
      </div>
    );
  }

  if (error || !album) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center">
        <div
          className="rounded-2xl p-8 border"
          style={{ backgroundColor: "var(--bg-card)", borderColor: "rgba(239,68,68,0.3)" }}
        >
          <p className="text-red-400 text-lg font-medium">エラーが発生しました</p>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            {error || "アルバムが見つかりません"}
          </p>
          <Link
            href="/"
            className="inline-block mt-6 px-6 py-2 rounded-xl text-sm font-medium"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            ホームに戻る
          </Link>
        </div>
      </div>
    );
  }

  const scoreColor = averageScore !== null ? getScoreColor(averageScore) : "#6b7280";

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm mb-6 hover:opacity-80 transition-opacity"
        style={{ color: "var(--text-secondary)" }}
      >
        ← ホームに戻る
      </Link>

      {/* Album header */}
      <div
        className="rounded-2xl overflow-hidden border mb-6"
        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex flex-col sm:flex-row">
          <div className="relative w-full sm:w-56 flex-shrink-0 aspect-square sm:aspect-auto">
            {displayCoverUrl ? (
              <Image
                src={displayCoverUrl}
                alt={`${album.title} by ${album.artist}`}
                fill
                sizes="(max-width: 640px) 100vw, 224px"
                className="object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: "#2a2a3a", minHeight: "224px" }}
              >
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "#6b7280" }}
                >
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1 p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-3">
                {album.genre && (
                  <span
                    className="inline-block px-3 py-1 rounded-full text-xs font-medium"
                    style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
                  >
                    {album.genre}
                  </span>
                )}
                <span
                  className="inline-block px-3 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}
                >
                  No. {album.no}
                </span>
              </div>
              <p className="text-sm font-medium mb-1" style={{ color: "var(--accent)" }}>
                {album.artist}
              </p>
              <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
                {album.title}
              </h1>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {album.date}
              </p>
            </div>
          </div>
        </div>

        {averageScore !== null && (
          <div className="px-6 py-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                平均スコア ({scores.length}件)
              </span>
              <span className="text-3xl font-bold" style={{ color: scoreColor }}>
                {averageScore.toFixed(1)}
                <span className="text-base font-normal ml-1" style={{ color: "var(--text-secondary)" }}>
                  / 10
                </span>
              </span>
            </div>
            <ScoreBar score={averageScore} showNumber={false} height="h-3" />
          </div>
        )}
      </div>

      {/* Individual scores */}
      {scores.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            メンバーのレビュー
          </h2>
          <div className="flex flex-col gap-4">
            {scores.map((s: Score, index: number) => (
              <div
                key={index}
                className="rounded-2xl p-5 border"
                style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}
                    >
                      {s.memberName.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                      {s.memberName}
                    </span>
                  </div>
                  <div
                    className="text-xl font-bold px-3 py-1 rounded-xl"
                    style={{
                      color: getScoreColor(s.score),
                      backgroundColor: `${getScoreColor(s.score)}18`,
                    }}
                  >
                    {s.score % 1 === 0 ? s.score.toFixed(1) : s.score}
                  </div>
                </div>
                <ScoreBar score={s.score} showNumber={false} height="h-2" />
                {s.comment && (
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {s.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score submission */}
      <div
        className="rounded-2xl p-6 border"
        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
      >
        <h2 className="text-lg font-bold mb-2" style={{ color: "var(--text-primary)" }}>
          レビューを投稿
        </h2>

        {status === "loading" && (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
        )}

        {status === "unauthenticated" && (
          <div className="text-center py-6">
            <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
              レビューを投稿するにはログインが必要です
            </p>
            <button
              onClick={() => signIn("google")}
              className="inline-flex items-center gap-3 px-6 py-3 rounded-xl font-medium text-sm hover:opacity-90"
              style={{ backgroundColor: "white", color: "#1f1f1f" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Googleでログイン
            </button>
          </div>
        )}

        {status === "authenticated" && (
          <>
            <div
              className="flex items-center gap-2 mb-5 p-3 rounded-xl"
              style={{ backgroundColor: "rgba(139,92,246,0.1)" }}
            >
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>ログイン中：</span>
              <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>
                {session.user?.name}
              </span>
            </div>

            {alreadyReviewed ? (
              <div
                className="rounded-xl p-4 border"
                style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}
              >
                <p className="text-green-400 font-medium text-sm">投稿済みです</p>
              </div>
            ) : (
              <>
                {submitSuccess && (
                  <div
                    className="rounded-xl p-4 mb-5 border"
                    style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}
                  >
                    <p className="text-green-400 font-medium text-sm">
                      レビューを投稿しました！ありがとうございます。
                    </p>
                  </div>
                )}

                <form onSubmit={handleSubmitScore} className="flex flex-col gap-5">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                      スコア
                      <span className="ml-3 text-2xl font-bold" style={{ color: getScoreColor(score) }}>
                        {score % 1 === 0 ? score.toFixed(1) : score}
                      </span>
                      <span className="text-sm font-normal ml-1" style={{ color: "var(--text-secondary)" }}>
                        / 10
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={0.5}
                      value={score}
                      onChange={(e) => setScore(parseFloat(e.target.value))}
                      className="w-full"
                      style={{ accentColor: getScoreColor(score) }}
                    />
                    <div className="flex justify-between text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                      <span>0</span>
                      <span>5</span>
                      <span>10</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                      コメント{" "}
                      <span style={{ color: "var(--text-secondary)" }}>(任意)</span>
                    </label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="アルバムの感想を書いてください..."
                      rows={4}
                      className="w-full px-4 py-3 rounded-xl border text-sm resize-none"
                      style={{
                        backgroundColor: "#12121a",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </div>

                  {submitError && <p className="text-red-400 text-sm">{submitError}</p>}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-50"
                    style={{ backgroundColor: "var(--accent)", color: "white" }}
                  >
                    {submitting ? "投稿中..." : "レビューを投稿する"}
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
