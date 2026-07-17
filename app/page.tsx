"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import AlbumCard from "@/components/AlbumCard";
import ReviewModal from "@/components/ReviewModal";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { buildScoreSummary, getCombinedScore, getMyReviewedAlbumNos, getSummaryEntry, ScoreSummary } from "@/lib/score-utils";

const GENRE_VALUES = ["邦楽", "洋楽"] as const;
const UP_NEXT_MJ_EXCLUDE = ["J採用", "採用", "不採用"];

function getMonthKey(date: string): string {
  return date.substring(0, 7);
}

function formatMonth(key: string): string {
  const [year, month] = key.split("/");
  return `${year}年${parseInt(month)}月`;
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const [albums, setAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [spotifyData, setSpotifyData] = useState<Record<string, { coverUrl: string; spotifyUrl: string }>>({});
  const [allScores, setAllScores] = useState<Score[]>([]);
  const [scoreSummary, setScoreSummary] = useState<ScoreSummary>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [genreFilters, setGenreFilters] = useState<string[]>([...GENRE_VALUES]);
  const [monthFilter, setMonthFilter] = useState<string>("すべて");
  const [mjFilters, setMjFilters] = useState<string[]>([]);
  const [mjInitialized, setMjInitialized] = useState(false);
  const [upNext, setUpNext] = useState(false);
  const [savedMjFilters, setSavedMjFilters] = useState<string[] | null>(null);
  const [myReviewedAlbumNos, setMyReviewedAlbumNos] = useState<Set<string>>(new Set());
  const [reviewFilter, setReviewFilter] = useState<"すべて" | "済み" | "未レビュー">("すべて");
  const [reviewedLoaded, setReviewedLoaded] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<ReleaseMasterAlbum | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/release-master");
        if (!res.ok) throw new Error((await res.json()).error || "取得失敗");
        const data: ReleaseMasterAlbum[] = await res.json();
        setAlbums(data);
        setLoading(false);

        // localStorageから保存済みフィルターを読む
        const savedFilters = (() => { try { return JSON.parse(localStorage.getItem("ryuryu_home_filters") || "{}"); } catch { return {}; } })();
        if (savedFilters.genre) setGenreFilters(savedFilters.genre);

        // 月の初期値：保存済みがあればそれを使い、なければ管理者設定→現在月の順にフォールバック
        const availableMonths = Array.from(new Set(data.map((a) => getMonthKey(a.date)).filter(Boolean))).sort().reverse();
        if (savedFilters.month) {
          setMonthFilter(savedFilters.month);
        } else {
          let defaultMonth = availableMonths[0] ?? "すべて";
          try {
            const settingsRes = await fetch("/api/admin/settings");
            if (settingsRes.ok) {
              const settings: Record<string, string> = await settingsRes.json();
              if (settings.default_month && (settings.default_month === "すべて" || availableMonths.includes(settings.default_month))) {
                defaultMonth = settings.default_month;
              }
            }
          } catch { /* 失敗時はフォールバック */ }
          setMonthFilter(defaultMonth);
        }

        // M/J採用：保存済みがあればそれを使い、なければ全値を初期選択
        const allMjValues = [
          ...Array.from(new Set(data.map((a) => a.mjAdoption).filter(Boolean))).sort(),
          ...(data.some((a) => !a.mjAdoption) ? ["空欄"] : []),
        ];
        setMjFilters(savedFilters.mj ?? allMjValues);
        setMjInitialized(true);
        if (savedFilters.upNext) {
          setUpNext(true);
          if (savedFilters.savedMj) setSavedMjFilters(savedFilters.savedMj);
        }
        if (savedFilters.review) setReviewFilter(savedFilters.review);

        // Pre-populate spotifyData from sheet cache
        const cachedData: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
        data.forEach((a) => {
          if (a.spotifyUrl || a.coverUrl) {
            cachedData[a.no] = { coverUrl: a.coverUrl, spotifyUrl: a.spotifyUrl };
          }
        });
        if (Object.keys(cachedData).length > 0) setSpotifyData(cachedData);

        // Trigger Release Master sync in background (fire-and-forget)
        fetch("/api/cron/sync-release-master").catch(() => {});

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
            setAllScores(scores);
            setScoreSummary(buildScoreSummary(scores));
          }),
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
        setLoading(false);
      }
    }
    init();
  }, []);

  // フィルター変更をlocalStorageに保存
  useEffect(() => {
    if (!mjInitialized) return;
    try {
      localStorage.setItem("ryuryu_home_filters", JSON.stringify({ month: monthFilter, genre: genreFilters, mj: mjFilters, upNext, savedMj: savedMjFilters, review: reviewFilter }));
    } catch {}
  }, [monthFilter, genreFilters, mjFilters, mjInitialized, upNext, savedMjFilters, reviewFilter]);

  // Up Next用：セッション・スコアが揃ったら自分のレビュー済みNoを計算
  useEffect(() => {
    const userEmail = session?.user?.email?.toLowerCase();
    if (!userEmail || allScores.length === 0) return;
    setMyReviewedAlbumNos(getMyReviewedAlbumNos(albums, allScores, userEmail));
    setReviewedLoaded(true);
  }, [session, allScores, albums]);

  function combinedScoreFor(album: ReleaseMasterAlbum) {
    return getCombinedScore(album, getSummaryEntry(scoreSummary, album)?.memberScores);
  }

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

  function toggleUpNext(currentMjValues: string[]) {
    if (!upNext) {
      setSavedMjFilters(mjFilters);
      const upNextMjValues = currentMjValues.filter((v) => !UP_NEXT_MJ_EXCLUDE.includes(v));
      setMjFilters(upNextMjValues);
      setUpNext(true);
      setReviewFilter("未レビュー");
    } else {
      setMjFilters(savedMjFilters ?? currentMjValues);
      setSavedMjFilters(null);
      setUpNext(false);
      setReviewFilter("すべて");
    }
  }

  function handleReviewFilter(value: "すべて" | "済み" | "未レビュー") {
    // 手動操作時は Up Next を OFF にする
    if (upNext) {
      setMjFilters(savedMjFilters ?? mjFilters);
      setSavedMjFilters(null);
      setUpNext(false);
    }
    setReviewFilter(value);
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
    if (reviewedLoaded && reviewFilter === "済み" && !myReviewedAlbumNos.has(a.no)) return false;
    if (reviewedLoaded && reviewFilter === "未レビュー" && myReviewedAlbumNos.has(a.no)) return false;
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
      {/* Search */}
      <div className="mb-4 relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="アーティスト名・アルバム名で検索..."
          className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50 pr-10"
          style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-xs transition-colors"
            style={{ backgroundColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3">
        {/* 月：プルダウン + Up Next */}
        <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2">
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>月：</span>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl border text-xs font-medium focus:outline-none"
              style={{ backgroundColor: "var(--bg-card)", borderColor: monthFilter !== "すべて" ? "var(--accent)" : "var(--border-subtle)", color: monthFilter !== "すべて" ? "white" : "var(--text-secondary)" }}
            >
              {months.map((m) => (
                <option key={m} value={m}>{m === "すべて" ? "すべて" : formatMonth(m)}</option>
              ))}
            </select>
            {session && (
              <button
                onClick={() => toggleUpNext(mjValues)}
                className="px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors"
                style={{
                  backgroundColor: upNext ? "rgba(139,92,246,0.25)" : "var(--bg-card)",
                  borderColor: upNext ? "var(--accent)" : "var(--border-subtle)",
                  color: upNext ? "white" : "var(--text-secondary)",
                }}
              >
                🎯 Up Next (for Review)
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[4rem_1fr] items-start gap-x-2">
          <span className="text-xs font-medium pt-1" style={{ color: "var(--text-secondary)" }}>ジャンル：</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={toggleAllGenre}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={{ backgroundColor: allGenreSelected ? "var(--accent)" : "var(--bg-card)", color: allGenreSelected ? "white" : "var(--text-secondary)", border: `1px solid ${allGenreSelected ? "var(--accent)" : "var(--border-subtle)"}` }}>
              すべて
            </button>
            {GENRE_VALUES.map((g) => {
              const active = genreFilters.includes(g);
              return (
                <button key={g} onClick={() => toggleGenreFilter(g)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{ backgroundColor: active ? "rgba(139,92,246,0.3)" : "var(--bg-card)", color: active ? "white" : "var(--text-secondary)", border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}` }}>
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-[4rem_1fr] items-start gap-x-2">
          <span className="text-xs font-medium pt-1" style={{ color: "var(--text-secondary)" }}>M/J採用：</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={toggleAllMj}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={{ backgroundColor: allMjSelected ? "var(--accent)" : "var(--bg-card)", color: allMjSelected ? "white" : "var(--text-secondary)", border: `1px solid ${allMjSelected ? "var(--accent)" : "var(--border-subtle)"}` }}>
              すべて
            </button>
            {mjValues.map((v) => {
              const active = mjFilters.includes(v);
              return (
                <button key={v} onClick={() => toggleMjFilter(v)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{ backgroundColor: active ? "rgba(139,92,246,0.3)" : "var(--bg-card)", color: active ? "white" : "var(--text-secondary)", border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}` }}>
                  {v}
                </button>
              );
            })}
          </div>
        </div>

        {/* レビュー */}
        {status === "authenticated" && (
          <div className="grid grid-cols-[4rem_1fr] items-center gap-x-2">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>レビュー：</span>
            <div className="flex flex-wrap gap-1.5">
              {(["すべて", "済み", "未レビュー"] as const).map((v) => {
                const active = reviewFilter === v;
                return (
                  <button key={v} onClick={() => handleReviewFilter(v)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                    style={{ backgroundColor: active ? "rgba(139,92,246,0.3)" : "var(--bg-card)", color: active ? "white" : "var(--text-secondary)", border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}` }}>
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 件数 */}
        <p className="text-xs text-right" style={{ color: "var(--text-secondary)" }}>{filtered.length}枚のアルバム</p>
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
              coverUrl={album.coverUrl || spotifyData[album.no]?.coverUrl}
              averageScore={combinedScoreFor(album).avg}
              scoreCount={combinedScoreFor(album).count}
              onClick={() => setSelectedAlbum(album)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {selectedAlbum && (
        <ReviewModal
          album={selectedAlbum}
          coverUrl={selectedAlbum.coverUrl || spotifyData[selectedAlbum.no]?.coverUrl}
          spotifyUrl={selectedAlbum.spotifyUrl || spotifyData[selectedAlbum.no]?.spotifyUrl}
          onClose={() => setSelectedAlbum(null)}
        />
      )}
    </div>
  );
}
