"use client";

import { useEffect, useState } from "react";
import AlbumCard from "@/components/AlbumCard";
import ReviewModal from "@/components/ReviewModal";
import { ReleaseMasterAlbum, Score } from "@/lib/types";

const GENRE_VALUES = ["邦楽", "洋楽"] as const;

function getMonthKey(date: string): string {
  return date.substring(0, 7);
}

function formatMonth(key: string): string {
  const [year, month] = key.split("/");
  return `${year}年${parseInt(month)}月`;
}

export default function HomePage() {
  const [albums, setAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [spotifyData, setSpotifyData] = useState<Record<string, { coverUrl: string; spotifyUrl: string }>>({});
  const [scoreSummary, setScoreSummary] = useState<Record<string, { avg: number; count: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [genreFilters, setGenreFilters] = useState<string[]>([...GENRE_VALUES]);
  const [monthFilter, setMonthFilter] = useState<string>("すべて");
  const [mjFilters, setMjFilters] = useState<string[]>([]);
  const [mjInitialized, setMjInitialized] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<ReleaseMasterAlbum | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/release-master");
        if (!res.ok) throw new Error((await res.json()).error || "取得失敗");
        const data: ReleaseMasterAlbum[] = await res.json();
        setAlbums(data);
        setLoading(false);

        // 月の初期値：現在月にアルバムがなければ最新月
        const availableMonths = Array.from(new Set(data.map((a) => getMonthKey(a.date)).filter(Boolean))).sort().reverse();
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
        const defaultMonth = availableMonths.includes(currentMonthKey) ? currentMonthKey : (availableMonths[0] ?? "すべて");
        setMonthFilter(defaultMonth);

        // M/J採用：全値を初期選択
        const allMjValues = [
          ...Array.from(new Set(data.map((a) => a.mjAdoption).filter(Boolean))).sort(),
          ...(data.some((a) => !a.mjAdoption) ? ["空欄"] : []),
        ];
        setMjFilters(allMjValues);
        setMjInitialized(true);

        // Pre-populate spotifyData from sheet cache
        const cachedData: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
        data.forEach((a) => {
          if (a.spotifyUrl || a.coverUrl) {
            cachedData[a.no] = { coverUrl: a.coverUrl, spotifyUrl: a.spotifyUrl };
          }
        });
        if (Object.keys(cachedData).length > 0) setSpotifyData(cachedData);

        // Only fetch Spotify for albums missing cache
        const missing = data.filter((a) => !a.spotifyUrl || !a.coverUrl);

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
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
        setLoading(false);
      }
    }
    init();
  }, []);

  const months = ["すべて", ...Array.from(new Set(albums.map((a) => getMonthKey(a.date)).filter(Boolean))).sort().reverse()];
  const mjValues = [
    ...Array.from(new Set(albums.map((a) => a.mjAdoption).filter(Boolean))).sort(),
    ...(albums.some((a) => !a.mjAdoption) ? ["空欄"] : []),
  ];
  const allMjSelected = mjInitialized && mjValues.length > 0 && mjValues.every((v) => mjFilters.includes(v));
  const allGenreSelected = GENRE_VALUES.every((v) => genreFilters.includes(v));

  function toggleMjFilter(value: string) {
    setMjFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function toggleAllMj() {
    setMjFilters(allMjSelected ? [] : mjValues);
  }

  function toggleGenreFilter(value: string) {
    setGenreFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function toggleAllGenre() {
    setGenreFilters(allGenreSelected ? [] : [...GENRE_VALUES]);
  }

  const filtered = albums.filter((a) => {
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      if (!a.title.toLowerCase().includes(q) && !a.artist.toLowerCase().includes(q)) return false;
    }
    if (genreFilters.length > 0 && !genreFilters.includes(a.genre || "")) return false;
    if (monthFilter !== "すべて" && getMonthKey(a.date) !== monthFilter) return false;
    if (mjInitialized && mjFilters.length > 0) {
      const val = a.mjAdoption || "空欄";
      if (!mjFilters.includes(val)) return false;
    }
    return true;
  });

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
        <p className="text-red-400 text-lg font-medium">エラーが発生しました</p>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>月次アルバムレビュー</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{filtered.length}枚のアルバム</p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="アーティスト名・アルバム名で検索..."
          className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50"
          style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
        />
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--text-secondary)" }}>月：</span>
          {months.map((m) => (
            <button key={m} onClick={() => setMonthFilter(m)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
              style={{ backgroundColor: monthFilter === m ? "var(--accent)" : "var(--bg-card)", color: monthFilter === m ? "white" : "var(--text-secondary)", border: `1px solid ${monthFilter === m ? "var(--accent)" : "var(--border-subtle)"}` }}>
              {m === "すべて" ? "すべて" : formatMonth(m)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--text-secondary)" }}>ジャンル：</span>
          <button
            onClick={toggleAllGenre}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
            style={{ backgroundColor: allGenreSelected ? "var(--accent)" : "var(--bg-card)", color: allGenreSelected ? "white" : "var(--text-secondary)", border: `1px solid ${allGenreSelected ? "var(--accent)" : "var(--border-subtle)"}` }}>
            すべて
          </button>
          {GENRE_VALUES.map((g) => {
            const active = genreFilters.includes(g);
            return (
              <button key={g} onClick={() => toggleGenreFilter(g)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
                style={{ backgroundColor: active ? "rgba(139,92,246,0.3)" : "var(--bg-card)", color: active ? "white" : "var(--text-secondary)", border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}` }}>
                {g}
              </button>
            );
          })}
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{genreFilters.length}件選択中</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--text-secondary)" }}>M/J採用：</span>
          <button
            onClick={toggleAllMj}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
            style={{ backgroundColor: allMjSelected ? "var(--accent)" : "var(--bg-card)", color: allMjSelected ? "white" : "var(--text-secondary)", border: `1px solid ${allMjSelected ? "var(--accent)" : "var(--border-subtle)"}` }}>
            すべて
          </button>
          {mjValues.map((v) => {
            const active = mjFilters.includes(v);
            return (
              <button key={v} onClick={() => toggleMjFilter(v)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
                style={{ backgroundColor: active ? "rgba(139,92,246,0.3)" : "var(--bg-card)", color: active ? "white" : "var(--text-secondary)", border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}` }}>
                {v}
              </button>
            );
          })}
          {mjInitialized && (
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {mjFilters.length}件選択中
            </span>
          )}
        </div>
      </div>

      {/* Album list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <p style={{ color: "var(--text-secondary)" }}>該当するアルバムはありません</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((album) => (
            <AlbumCard
              key={album.no}
              album={album}
              coverUrl={spotifyData[album.no]?.coverUrl}
              averageScore={scoreSummary[album.no]?.avg ?? null}
              scoreCount={scoreSummary[album.no]?.count ?? 0}
              onClick={() => setSelectedAlbum(album)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
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
