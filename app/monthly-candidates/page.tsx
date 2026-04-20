"use client";

import { useState } from "react";

interface AlbumSource {
  name: string;
  score: number | null;
  note: string;
}

interface AlbumCandidate {
  title: string;
  artist: string;
  country: string;
  genres: string[];
  sources: AlbumSource[];
  hypeScore: number;
  spotifySearchQuery: string;
}

interface ApiResponse {
  month: string;
  albums: AlbumCandidate[];
}

const GENRE_OPTIONS = [
  { value: "all",        label: "すべて" },
  { value: "indie",      label: "インディー・オルタナ" },
  { value: "electronic", label: "エレクトロニック・実験" },
  { value: "japan",      label: "日本" },
];

function getMonthOptions(): { value: string; label: string }[] {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    options.push({ value, label });
  }
  return options;
}

function HypeBadge({ score }: { score: number }) {
  if (score >= 80) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/60 text-green-300 border border-green-700/50">
        高評価 {score}
      </span>
    );
  }
  if (score >= 60) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-900/60 text-yellow-300 border border-yellow-700/50">
        話題作 {score}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700">
      チェック {score}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-5 animate-pulse">
      <div className="h-5 bg-gray-700 rounded w-3/4 mb-2" />
      <div className="h-4 bg-gray-700 rounded w-1/2 mb-4" />
      <div className="flex gap-2 mb-3">
        <div className="h-5 bg-gray-700 rounded-full w-16" />
        <div className="h-5 bg-gray-700 rounded-full w-20" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3 bg-gray-700 rounded w-full" />
        <div className="h-3 bg-gray-700 rounded w-4/5" />
      </div>
    </div>
  );
}

function AlbumCard({ album }: { album: AlbumCandidate }) {
  const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(album.spotifySearchQuery)}`;
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-5 flex flex-col gap-3">
      {/* タイトル・アーティスト・国 */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-white text-base leading-snug">{album.title}</h3>
          <span className="text-xs text-gray-500 shrink-0 mt-0.5">{album.country}</span>
        </div>
        <p className="text-sm text-gray-400 mt-0.5">{album.artist}</p>
      </div>

      {/* hypeScore バッジ */}
      <HypeBadge score={album.hypeScore} />

      {/* ジャンルタグ */}
      {album.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {album.genres.map((g) => (
            <span key={g} className="px-2 py-0.5 rounded-full text-xs bg-gray-700/70 text-gray-300 border border-gray-600/50">
              {g}
            </span>
          ))}
        </div>
      )}

      {/* ソーススコア */}
      {album.sources.length > 0 && (
        <ul className="space-y-1">
          {album.sources.map((src, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-gray-400">
              <span className="font-medium text-gray-300 w-24 shrink-0">{src.name}</span>
              <span>{src.note}</span>
            </li>
          ))}
        </ul>
      )}

      {/* アクションボタン */}
      <div className="flex gap-2 mt-auto pt-1">
        <a
          href={spotifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center py-2 rounded-xl text-xs font-semibold bg-[#1DB954]/90 hover:bg-[#1DB954] text-white transition-colors"
        >
          Spotifyで検索
        </a>
        <button
          disabled
          className="flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-700/50 text-gray-500 cursor-not-allowed border border-gray-600/30"
        >
          近日実装
        </button>
      </div>
    </div>
  );
}

export default function MonthlyCandidatesPage() {
  const monthOptions = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value);
  const [selectedGenre, setSelectedGenre] = useState("all");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/monthly-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth: selectedMonth, genre: selectedGenre }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
      setResult(data as ApiResponse);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <h1 className="text-xl font-bold mb-6 text-white">Monthly Selection 候補</h1>

        {/* 月セレクタ */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">月</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-sm text-white focus:outline-none focus:border-violet-500"
          >
            {monthOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* ジャンルフィルター */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">ジャンル</label>
          <div className="flex flex-wrap gap-2">
            {GENRE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedGenre(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  selectedGenre === opt.value
                    ? "bg-violet-600 border-violet-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 検索ボタン */}
        <button
          onClick={handleSearch}
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors mb-8"
        >
          {loading ? "検索中…" : "候補を探す"}
        </button>

        {/* エラー */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-900/30 border border-red-700/50 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* スケルトン */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* 結果 */}
        {result && !loading && (
          <>
            <p className="text-xs text-gray-500 mb-4">{result.albums.length}件のアルバム候補</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {result.albums.map((album, i) => (
                <AlbumCard key={i} album={album} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
