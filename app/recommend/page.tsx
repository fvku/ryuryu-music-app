"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Recommendation } from "@/lib/sheets";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import ReviewModal from "@/components/ReviewModal";

export default function RecommendPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [albums, setAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [spotifyData, setSpotifyData] = useState<Record<string, { coverUrl: string; spotifyUrl: string }>>({});
  const [scoreSummary, setScoreSummary] = useState<Record<string, { avg: number; count: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<ReleaseMasterAlbum | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [recRes, albumRes] = await Promise.all([
          fetch("/api/recommendations"),
          fetch("/api/release-master"),
        ]);
        if (!recRes.ok) throw new Error("レコメンドの取得に失敗しました");
        if (!albumRes.ok) throw new Error("アルバム情報の取得に失敗しました");

        const [recData, albumData]: [Recommendation[], ReleaseMasterAlbum[]] = await Promise.all([
          recRes.json(),
          albumRes.json(),
        ]);

        setRecommendations(recData);
        setAlbums(albumData);

        // Spotify cache from sheet
        const cached: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
        albumData.forEach((a) => {
          if (a.spotifyUrl || a.coverUrl) cached[a.no] = { coverUrl: a.coverUrl, spotifyUrl: a.spotifyUrl };
        });
        if (Object.keys(cached).length > 0) setSpotifyData(cached);

        // Fetch missing Spotify data
        const missing = albumData.filter((a) => !a.spotifyUrl || !a.coverUrl);
        Promise.all([
          missing.length > 0
            ? fetch("/api/spotify/covers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ albums: missing.map((a) => ({ no: a.no, title: a.title, artist: a.artist })) }),
              }).then((r) => r.ok ? r.json() : {}).then((newData: Record<string, { coverUrl: string; spotifyUrl: string }>) => {
                setSpotifyData((prev) => ({ ...prev, ...newData }));
              })
            : Promise.resolve(),

          fetch("/api/scores").then((r) => r.ok ? r.json() : []).then((scores: Score[]) => {
            const summary: Record<string, { avg: number; count: number; total: number }> = {};
            scores.forEach((s) => {
              if (!summary[s.reviewId]) summary[s.reviewId] = { avg: 0, count: 0, total: 0 };
              summary[s.reviewId].total += s.score;
              summary[s.reviewId].count += 1;
              summary[s.reviewId].avg = Math.round((summary[s.reviewId].total / summary[s.reviewId].count) * 10) / 10;
            });
            setScoreSummary(summary);
          }),
        ]);
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>レコメンド</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>メンバーからのおすすめアルバム</p>
      </div>

      {recommendations.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">💿</p>
          <p style={{ color: "var(--text-secondary)" }}>まだレコメンドがありません</p>
          <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>アルバムのモーダルからレコメンドできます</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {[...recommendations].reverse().map((rec) => {
            const album = albumMap.get(rec.albumNo);
            const spotify = spotifyData[rec.albumNo];
            const coverUrl = spotify?.coverUrl || rec.coverUrl;
            const score = scoreSummary[rec.albumNo];

            return (
              <div
                key={rec.id}
                className="rounded-2xl p-5 border cursor-pointer transition-all hover:-translate-y-0.5 hover:border-violet-500/40 active:scale-[0.99]"
                style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
                onClick={() => album && setSelectedAlbum(album)}
              >
                <div className="flex gap-4 items-center">
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                    {coverUrl ? (
                      <Image src={coverUrl} alt={rec.albumTitle} fill sizes="56px" className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{rec.albumTitle}</p>
                    <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{rec.artistName}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {album?.date && (
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
                      )}
                      {score != null && (
                        <span className="text-xs font-bold" style={{ color: score.avg >= 8 ? "#22c55e" : score.avg >= 6 ? "#eab308" : "#ef4444" }}>
                          ★ {score.avg.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                        {rec.recommenderId.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{rec.recommenderId} がレコメンド</span>
                    </div>
                  </div>
                </div>
                {rec.message && (
                  <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    &ldquo;{rec.message}&rdquo;
                  </p>
                )}
              </div>
            );
          })}
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
