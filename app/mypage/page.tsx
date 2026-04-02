"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useSession, signIn, signOut } from "next-auth/react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { Bookmark } from "@/lib/sheets";
import { LEGACY_NAME_TO_EMAIL, parseLegacyScoreNum } from "@/lib/members";
import ReviewModal from "@/components/ReviewModal";

export default function MyPage() {
  const { data: session, status } = useSession();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [albums, setAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [spotifyData, setSpotifyData] = useState<Record<string, { coverUrl: string; spotifyUrl: string }>>({});
  const [scoreSummary, setScoreSummary] = useState<Record<string, { avg: number; count: number; total: number; members: Set<string> }>>({});
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<ReleaseMasterAlbum | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") { setLoading(false); return; }
    if (status !== "authenticated") return;

    async function init() {
      try {
        const [bmRes, albumRes] = await Promise.all([
          fetch("/api/bookmarks"),
          fetch("/api/release-master"),
        ]);
        const [bmData, albumData]: [Bookmark[], ReleaseMasterAlbum[]] = await Promise.all([
          bmRes.ok ? bmRes.json() : [],
          albumRes.ok ? albumRes.json() : [],
        ]);
        setBookmarks(bmData);
        setAlbums(albumData);

        const cached: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
        albumData.forEach((a) => {
          if (a.spotifyUrl || a.coverUrl) cached[a.no] = { coverUrl: a.coverUrl, spotifyUrl: a.spotifyUrl };
        });
        if (Object.keys(cached).length > 0) setSpotifyData(cached);

        const bmNos = new Set(bmData.map((b) => b.albumNo));
        const missing = albumData.filter((a) => bmNos.has(a.no) && (!a.spotifyUrl || !a.coverUrl));

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
            const summary: Record<string, { avg: number; count: number; total: number; members: Set<string> }> = {};
            scores.forEach((s) => {
              if (!summary[s.reviewId]) summary[s.reviewId] = { avg: 0, count: 0, total: 0, members: new Set() };
              summary[s.reviewId].total += s.score;
              summary[s.reviewId].count += 1;
              summary[s.reviewId].members.add(s.memberName.toLowerCase());
              summary[s.reviewId].avg = Math.round((summary[s.reviewId].total / summary[s.reviewId].count) * 10) / 10;
            });
            setScoreSummary(summary);
          }),
        ]);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [status]);

  if (status === "loading" || loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-full border-4 animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
        <p style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-card)" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-secondary)" }}>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="text-center">
          <p className="font-bold text-lg mb-1" style={{ color: "var(--text-primary)" }}>ログインが必要です</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>マイページを利用するにはGoogleログインしてください</p>
        </div>
        <button
          onClick={() => signIn("google")}
          className="inline-flex items-center gap-3 px-6 py-3 rounded-xl font-medium text-sm hover:opacity-90"
          style={{ backgroundColor: "white", color: "#1f1f1f" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Googleでログイン
        </button>
      </div>
    );
  }

  const albumMap = new Map(albums.map((a) => [a.no, a]));
  const bookmarkedAlbums = bookmarks.map((b) => albumMap.get(b.albumNo)).filter(Boolean) as ReleaseMasterAlbum[];

  function getScoreColor(score: number) {
    if (score >= 8) return "#22c55e";
    if (score >= 6) return "#eab308";
    return "#ef4444";
  }

  function getCombinedScore(album: ReleaseMasterAlbum) {
    const app = scoreSummary[album.no];
    const appMembers = app?.members ?? new Set<string>();
    let legacyTotal = 0, legacyCount = 0;
    for (const ls of album.legacyScores) {
      const email = LEGACY_NAME_TO_EMAIL[ls.name.toLowerCase()];
      if (email && appMembers.has(email)) continue;
      if (appMembers.has(ls.name.toLowerCase())) continue;
      const n = parseLegacyScoreNum(ls.value);
      if (n !== null && n >= 0 && n <= 10) { legacyTotal += n; legacyCount++; }
    }
    const total = (app?.total ?? 0) + legacyTotal;
    const count = (app?.count ?? 0) + legacyCount;
    if (count === 0) return null;
    return { avg: Math.round((total / count) * 10) / 10, count };
  }

  return (
    <div>
      {/* Profile */}
      <div className="rounded-2xl p-6 border mb-6 flex items-center gap-4" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        {session.user?.image && (
          <Image src={session.user.image} alt={session.user.name ?? ""} width={56} height={56} className="rounded-full flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-lg truncate" style={{ color: "var(--text-primary)" }}>{session.user?.name}</p>
          <p className="text-sm truncate" style={{ color: "var(--text-secondary)" }}>{session.user?.email}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="text-sm px-3 py-1.5 rounded-lg border flex-shrink-0"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          ログアウト
        </button>
      </div>

      {/* Bookmarks */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>気になるリスト</h2>
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{bookmarkedAlbums.length}枚</span>
      </div>

      {bookmarkedAlbums.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">🔖</p>
          <p style={{ color: "var(--text-secondary)" }}>保存されたアルバムはありません</p>
          <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>アルバムのモーダルからブックマーク保存できます</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {bookmarkedAlbums.map((album) => {
            const spotify = spotifyData[album.no];
            const score = getCombinedScore(album);
            return (
              <div
                key={album.no}
                onClick={() => setSelectedAlbum(album)}
                className="flex items-center gap-4 p-4 rounded-2xl border transition-all hover:-translate-y-0.5 hover:border-violet-500/40 cursor-pointer active:scale-[0.99]"
                style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
              >
                <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                  {spotify?.coverUrl ? (
                    <Image src={spotify.coverUrl} alt={album.title} fill sizes="56px" className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
                  <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{album.artist}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
                    {album.genre && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>{album.genre}</span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right min-w-[48px]">
                  {score != null ? (
                    <>
                      <p className="font-bold text-base" style={{ color: getScoreColor(score.avg) }}>{score.avg.toFixed(1)}</p>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{score.count}件</p>
                    </>
                  ) : album.legacyScores.length > 0 ? (
                    <p className="text-xs" style={{ color: "var(--accent)" }}>レビューあり</p>
                  ) : (
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>未評価</p>
                  )}
                </div>
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
