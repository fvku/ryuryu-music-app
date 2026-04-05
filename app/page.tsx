"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import AlbumCard from "@/components/AlbumCard";
import ReviewModal from "@/components/ReviewModal";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { LEGACY_NAME_TO_EMAIL, parseLegacyScoreNum, EMAIL_TO_SHORT_NAME } from "@/lib/members";

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
  const { data: session } = useSession();
  const [albums, setAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [spotifyData, setSpotifyData] = useState<Record<string, { coverUrl: string; spotifyUrl: string }>>({});
  const [scoreSummary, setScoreSummary] = useState<Record<string, { avg: number; count: number; total: number; members: Set<string>; memberScores: Record<string, number> }>>({});
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

        // 月の初期値：保存済みがあればそれを使い、なければ現在月
        const availableMonths = Array.from(new Set(data.map((a) => getMonthKey(a.date)).filter(Boolean))).sort().reverse();
        if (savedFilters.month) {
          setMonthFilter(savedFilters.month);
        } else {
          const now = new Date();
          const currentMonthKey = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
          const defaultMonth = availableMonths.includes(currentMonthKey) ? currentMonthKey : (availableMonths[0] ?? "すべて");
          setMonthFilter(defaultMonth);
        }

        // M/J採用：保存済みがあればそれを使い、なければ全値を初期選択
        const allMjValues = [
          ...Array.from(new Set(data.map((a) => a.mjAdoption).filter(Boolean))).sort(),
          ...(data.some((a) => !a.mjAdoption) ? ["空欄"] : []),
        ];
        setMjFilters(savedFilters.mj ?? allMjValues);
        setMjInitialized(true);

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
            const summary: Record<string, { avg: number; count: number; total: number; members: Set<string>; memberScores: Record<string, number> }> = {};
            scores.forEach((s) => {
              if (!summary[s.reviewId]) summary[s.reviewId] = { avg: 0, count: 0, total: 0, members: new Set(), memberScores: {} };
              summary[s.reviewId].members.add(s.memberName.toLowerCase());
              if (s.score !== null) {
                summary[s.reviewId].total += s.score;
                summary[s.reviewId].count += 1;
                summary[s.reviewId].memberScores[s.memberName.toLowerCase()] = s.score;
                summary[s.reviewId].avg = Math.round((summary[s.reviewId].total / summary[s.reviewId].count) * 10) / 10;
              }
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

  // フィルター変更をlocalStorageに保存
  useEffect(() => {
    if (!mjInitialized) return;
    try {
      localStorage.setItem("ryuryu_home_filters", JSON.stringify({ month: monthFilter, genre: genreFilters, mj: mjFilters }));
    } catch {}
  }, [monthFilter, genreFilters, mjFilters, mjInitialized]);

  // Up Next用：セッション・スコアが揃ったら自分のレビュー済みNoを計算
  useEffect(() => {
    const userEmail = session?.user?.email?.toLowerCase();
    if (!userEmail || Object.keys(scoreSummary).length === 0) return;
    const shortName = EMAIL_TO_SHORT_NAME[userEmail] ?? null;
    const reviewed = new Set<string>();
    Object.entries(scoreSummary).forEach(([albumNo, s]) => {
      if (s.memberScores[userEmail] !== undefined || (shortName && s.memberScores[shortName.toLowerCase()] !== undefined)) {
        reviewed.add(albumNo);
      }
    });
    // legacyScores からも追加
    albums.forEach((a) => {
      if (a.legacyScores.some((ls) =>
        ls.name.toLowerCase() === userEmail ||
        (shortName && ls.name.toLowerCase() === shortName.toLowerCase())
      )) {
        reviewed.add(a.no);
      }
    });
    setMyReviewedAlbumNos(reviewed);
  }, [session, scoreSummary, albums]); // eslint-disable-line react-hooks/exhaustive-deps

  function getCombinedScore(album: ReleaseMasterAlbum) {
    const app = scoreSummary[album.no];
    // Release Master scores take priority: collect all valid legacy scores
    const legacyCoveredIds = new Set<string>();
    let legacyTotal = 0, legacyCount = 0;
    for (const ls of album.legacyScores) {
      const n = parseLegacyScoreNum(ls.value);
      if (n !== null && n >= 0 && n <= 10) {
        legacyTotal += n; legacyCount++;
        const email = LEGACY_NAME_TO_EMAIL[ls.name.toLowerCase()];
        if (email) legacyCoveredIds.add(email);
        legacyCoveredIds.add(ls.name.toLowerCase());
      }
    }
    // Only add app scores for members not covered by Release Master
    let appOnlyTotal = 0, appOnlyCount = 0;
    for (const [member, score] of Object.entries(app?.memberScores ?? {})) {
      if (!legacyCoveredIds.has(member)) { appOnlyTotal += score; appOnlyCount++; }
    }
    const total = legacyTotal + appOnlyTotal;
    const count = legacyCount + appOnlyCount;
    if (count === 0) return { avg: null, count: 0 };
    return { avg: Math.round((total / count) * 10) / 10, count };
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
      // ON: 現在のM/Jフィルタを保存し、Up Next条件の値だけ選択
      setSavedMjFilters(mjFilters);
      const upNextMjValues = currentMjValues.filter((v) => !UP_NEXT_MJ_EXCLUDE.includes(v));
      setMjFilters(upNextMjValues);
      setUpNext(true);
    } else {
      // OFF: 保存していたM/Jフィルタを復元
      setMjFilters(savedMjFilters ?? currentMjValues);
      setSavedMjFilters(null);
      setUpNext(false);
    }
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
    if (upNext && myReviewedAlbumNos.has(a.no)) return false;
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
              coverUrl={spotifyData[album.no]?.coverUrl}
              averageScore={getCombinedScore(album).avg}
              scoreCount={getCombinedScore(album).count}
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
