"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { Recommendation } from "@/lib/sheets";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import ReviewModal from "@/components/ReviewModal";
import { getDisplayName } from "@/lib/members";

type TimelineItem =
  | { type: "recommendation"; data: Recommendation; createdAt: string }
  | { type: "review"; data: Score; createdAt: string };

function getScoreColor(score: number) {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#eab308";
  return "#ef4444";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getMonthKey(date: string): string {
  return date.substring(0, 7);
}

function formatMonth(key: string): string {
  const [year, month] = key.split("/");
  return `${year}年${parseInt(month)}月`;
}

export default function RecommendPage() {
  const { data: session } = useSession();
  const myEmail = session?.user?.email?.toLowerCase() ?? null;
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [albums, setAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [spotifyData, setSpotifyData] = useState<Record<string, { coverUrl: string; spotifyUrl: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<ReleaseMasterAlbum | null>(null);
  const [displayCount, setDisplayCount] = useState(20);
  const [monthFilter, setMonthFilter] = useState("すべて");
  const [memberFilter, setMemberFilter] = useState("すべて");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(() => setDisplayCount((prev) => prev + 20), []);

  // フィルター変更時はリストを先頭に戻す
  useEffect(() => { setDisplayCount(20); }, [monthFilter, memberFilter]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, timeline.length]);

  useEffect(() => {
    async function init() {
      try {
        const [recRes, albumRes, scoresRes] = await Promise.all([
          fetch("/api/recommendations"),
          fetch("/api/release-master"),
          fetch("/api/scores"),
        ]);

        const [recData, albumData, scoresData]: [Recommendation[], ReleaseMasterAlbum[], Score[]] = await Promise.all([
          recRes.ok ? recRes.json() : [],
          albumRes.ok ? albumRes.json() : [],
          scoresRes.ok ? scoresRes.json() : [],
        ]);

        setAlbums(albumData);

        const cached: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
        albumData.forEach((a) => {
          if (a.spotifyUrl || a.coverUrl) cached[a.no] = { coverUrl: a.coverUrl, spotifyUrl: a.spotifyUrl };
        });
        if (Object.keys(cached).length > 0) setSpotifyData(cached);

        const missing = albumData.filter((a) => !a.spotifyUrl || !a.coverUrl);
        if (missing.length > 0) {
          fetch("/api/spotify/covers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ albums: missing.map((a) => ({ no: a.no, title: a.title, artist: a.artist })) }),
          }).then((r) => r.ok ? r.json() : {}).then((newData: Record<string, { coverUrl: string; spotifyUrl: string }>) => {
            setSpotifyData((prev) => ({ ...prev, ...newData }));
          });
        }

        const items: TimelineItem[] = [
          ...recData.map((r) => ({ type: "recommendation" as const, data: r, createdAt: r.createdAt })),
          ...scoresData.filter((s) => s.submittedAt).map((s) => ({ type: "review" as const, data: s, createdAt: s.submittedAt })),
        ];
        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setTimeline(items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "エラーが発生しました");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-full border-4 animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
        <p style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl p-8 text-center border" style={{ backgroundColor: "var(--bg-card)", borderColor: "rgba(239,68,68,0.3)" }}>
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  const albumMap = new Map(albums.map((a) => [a.no, a]));
  const albumByTitleArtist = new Map(albums.map((a) => [`${a.title}::${a.artist}`, a]));

  function getAlbumForItem(item: TimelineItem): ReleaseMasterAlbum | undefined {
    if (item.type === "review") {
      return albumByTitleArtist.get(`${item.data.albumTitle}::${item.data.artistName}`) ?? albumMap.get(item.data.reviewId);
    }
    return albumByTitleArtist.get(`${item.data.albumTitle}::${item.data.artistName}`) ?? albumMap.get(item.data.albumNo);
  }

  function getItemMember(item: TimelineItem): string {
    return item.type === "review" ? item.data.memberName : item.data.recommenderId;
  }

  // 月一覧（アルバムの date から）
  const availableMonths = Array.from(
    new Set(
      timeline
        .map((item) => getAlbumForItem(item)?.date)
        .filter((d): d is string => !!d)
        .map((d) => getMonthKey(d))
    )
  ).sort().reverse();

  // メンバー一覧（タイムラインに登場する人）
  const availableMembers = Array.from(
    new Set(timeline.map((item) => getItemMember(item)).filter(Boolean))
  ).sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));

  // フィルター適用
  const filteredTimeline = timeline.filter((item) => {
    if (monthFilter !== "すべて") {
      const album = getAlbumForItem(item);
      if (!album?.date || getMonthKey(album.date) !== monthFilter) return false;
    }
    if (memberFilter !== "すべて" && getItemMember(item) !== memberFilter) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>タイムライン</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>レビューとレコメンドの最新情報</p>
      </div>

      {/* フィルター */}
      <div className="mb-5 flex flex-col gap-3">
        {/* 月 */}
        <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>月：</span>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border text-xs font-medium focus:outline-none w-fit"
            style={{
              backgroundColor: "var(--bg-card)",
              borderColor: monthFilter !== "すべて" ? "var(--accent)" : "var(--border-subtle)",
              color: monthFilter !== "すべて" ? "white" : "var(--text-secondary)",
            }}
          >
            <option value="すべて">すべて</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>{formatMonth(m)}</option>
            ))}
          </select>
        </div>

        {/* メンバー */}
        <div className="grid grid-cols-[4rem_1fr] items-start gap-x-2">
          <span className="text-xs font-medium pt-1" style={{ color: "var(--text-secondary)" }}>メンバー：</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setMemberFilter("すべて")}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={{
                backgroundColor: memberFilter === "すべて" ? "var(--accent)" : "var(--bg-card)",
                color: memberFilter === "すべて" ? "white" : "var(--text-secondary)",
                border: `1px solid ${memberFilter === "すべて" ? "var(--accent)" : "var(--border-subtle)"}`,
              }}
            >
              すべて
            </button>
            {availableMembers.map((m) => {
              const active = memberFilter === m;
              return (
                <button
                  key={m}
                  onClick={() => setMemberFilter(active ? "すべて" : m)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: active ? "rgba(139,92,246,0.3)" : "var(--bg-card)",
                    color: active ? "white" : "var(--text-secondary)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}`,
                  }}
                >
                  {getDisplayName(m)}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-right" style={{ color: "var(--text-secondary)" }}>{filteredTimeline.length}件</p>
      </div>

      {filteredTimeline.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">🎵</p>
          <p style={{ color: "var(--text-secondary)" }}>該当する投稿がありません</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredTimeline.slice(0, displayCount).map((item, i) => {
            if (item.type === "recommendation") {
              const rec = item.data;
              const album = getAlbumForItem(item);
              const coverUrl = (album ? spotifyData[album.no]?.coverUrl : undefined) || rec.coverUrl;
              return (
                <div
                  key={`rec-${rec.id}-${i}`}
                  className="rounded-2xl p-4 border cursor-pointer transition-all hover:-translate-y-0.5 hover:border-violet-500/40 active:scale-[0.99]"
                  style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
                  onClick={() => album && setSelectedAlbum(album)}
                >
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                      {getDisplayName(rec.recommenderId).charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{getDisplayName(rec.recommenderId)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>レコメンド</span>
                    {rec.mentionedEmails.length > 0 && (
                      <span className="text-xs flex items-center gap-1 flex-wrap">
                        {rec.mentionedEmails.map((e) => (
                          <span
                            key={e}
                            className="px-1.5 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor: e === myEmail ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.08)",
                              color: e === myEmail ? "#eab308" : "var(--text-secondary)",
                            }}
                          >
                            @{getDisplayName(e)}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>{formatDate(rec.createdAt)}</span>
                  </div>
                  <div className="flex gap-3 items-center">
                    <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                      {coverUrl ? (
                        <Image src={coverUrl} alt={rec.albumTitle} fill sizes="48px" className="object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{rec.albumTitle}</p>
                      <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{rec.artistName}</p>
                      {album?.date && <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{album.date}</p>}
                    </div>
                  </div>
                  {rec.message && (
                    <p className="mt-3 text-sm leading-relaxed pl-1" style={{ color: "var(--text-secondary)" }}>
                      &ldquo;{rec.message}&rdquo;
                    </p>
                  )}
                </div>
              );
            }

            const review = item.data;
            const album = getAlbumForItem(item);
            const coverUrl = album ? spotifyData[album.no]?.coverUrl : undefined;
            return (
              <div
                key={`rev-${review.reviewId}-${review.memberName}-${i}`}
                className="rounded-2xl p-4 border cursor-pointer transition-all hover:-translate-y-0.5 hover:border-violet-500/40 active:scale-[0.99]"
                style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
                onClick={() => album && setSelectedAlbum(album)}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                    {getDisplayName(review.memberName).charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{getDisplayName(review.memberName)}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" }}>レビュー</span>
                  <span className="text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>{formatDate(review.submittedAt)}</span>
                </div>
                <div className="flex gap-3 items-center">
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                    {coverUrl ? (
                      <Image src={coverUrl} alt={review.albumTitle || review.reviewId} fill sizes="48px" className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{review.albumTitle || album?.title || review.reviewId}</p>
                    <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{review.artistName || album?.artist || ""}</p>
                    {album?.date && <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{album.date}</p>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {review.score !== null && (
                      <span className="font-bold text-lg px-2 py-0.5 rounded-lg" style={{ color: getScoreColor(review.score), backgroundColor: `${getScoreColor(review.score)}18` }}>
                        {review.score % 1 === 0 ? review.score.toFixed(1) : review.score}
                      </span>
                    )}
                  </div>
                </div>
                {review.comment && (
                  <p className="mt-3 text-sm leading-relaxed pl-1" style={{ color: "var(--text-secondary)" }}>
                    &ldquo;{review.comment}&rdquo;
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && displayCount < filteredTimeline.length && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
        </div>
      )}

      {selectedAlbum && (
        <ReviewModal
          album={selectedAlbum}
          coverUrl={spotifyData[selectedAlbum.no]?.coverUrl}
          spotifyUrl={spotifyData[selectedAlbum.no]?.spotifyUrl}
          onClose={() => setSelectedAlbum(null)}
        />
      )}
    </div>
  );
}
