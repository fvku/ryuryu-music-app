"use client";

import { useState } from "react";
import Image from "next/image";
import { useGlobalReviewModal } from "@/contexts/GlobalReviewModalContext";

interface AlbumSource {
  name: string;
  score: number | null;
  note: string;
  url?: string | null;
}

interface AlbumCandidate {
  title: string;
  artist: string;
  country: string;
  releaseDate?: string;
  genres: string[];
  sources: AlbumSource[];
  hypeScore: number;
  spotifySearchQuery: string;
  coverUrl?: string;
  spotifyUrl?: string;
  spotifyId?: string;
  /** string = Release Master に存在（No.）, null = 未登録, undefined = 未確認 */
  rmNo?: string | null;
}

interface ApiResponse {
  month: string;
  albums: AlbumCandidate[];
}

const SPOTIFY_ID_RE = /open\.spotify\.com\/(?:[^/]+\/)?album\/([A-Za-z0-9]+)/;

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
      <div className="flex gap-3 mb-3">
        <div className="w-16 h-16 rounded-lg bg-gray-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-700 rounded w-1/2 mb-1" />
          <div className="h-3 bg-gray-700 rounded w-1/3" />
        </div>
      </div>
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

interface AlbumCardProps {
  album: AlbumCandidate;
  adding: boolean;
  addError: string | null;
  onOpenReview: (no: string) => void;
  onAdd: () => void;
}

function AlbumCard({ album, adding, addError, onOpenReview, onAdd }: AlbumCardProps) {
  const spotifyUrl = album.spotifyUrl ?? `https://open.spotify.com/search/${encodeURIComponent(album.spotifySearchQuery)}`;
  const inRM = typeof album.rmNo === "string";
  const notInRM = album.rmNo === null;

  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-2xl p-5 flex flex-col gap-3">
      {/* カバー + タイトル */}
      <div className="flex items-start gap-3">
        {album.coverUrl ? (
          <Image src={album.coverUrl} alt={album.title} width={64} height={64}
            className="rounded-lg flex-shrink-0 object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-lg flex-shrink-0 bg-gray-700/60" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <h3 className="font-bold text-white text-sm leading-snug">{album.title}</h3>
            <span className="text-xs text-gray-500 shrink-0 mt-0.5">{album.country}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{album.artist}</p>
          {album.releaseDate && (
            <p className="text-xs text-gray-500 mt-0.5">{album.releaseDate}</p>
          )}
        </div>
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

      {/* ソーススコア（リンク付き） */}
      {album.sources.length > 0 && (
        <ul className="space-y-1">
          {album.sources.map((src, i) => (
            <li key={i} className="flex items-center gap-2 text-xs text-gray-400">
              <span className="font-medium text-gray-300 w-24 shrink-0">{src.name}</span>
              {src.url ? (
                <a href={src.url} target="_blank" rel="noopener noreferrer"
                  className="underline hover:text-gray-200 transition-colors">
                  {src.note}
                </a>
              ) : (
                <span>{src.note}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {addError && (
        <p className="text-xs" style={{ color: "#f87171" }}>{addError}</p>
      )}

      {/* アクションボタン */}
      <div className="flex gap-2 mt-auto pt-1">
        <a href={spotifyUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold bg-[#1DB954]/90 hover:bg-[#1DB954] text-white transition-colors">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="mr-1.5">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          聴く
        </a>

        {inRM && album.rmNo ? (
          <button
            onClick={() => onOpenReview(album.rmNo!)}
            className="flex-1 py-2 rounded-xl text-xs font-semibold bg-violet-700/80 hover:bg-violet-600 text-white transition-colors"
          >
            レビューを開く
          </button>
        ) : notInRM ? (
          <button
            onClick={onAdd}
            disabled={adding}
            className="flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white transition-colors border border-gray-600"
          >
            {adding ? "追加中…" : "追加する"}
          </button>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </div>
  );
}

// ---- キャッシュ ----
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(yearMonth: string, genre: string) {
  return `monthly-candidates:${yearMonth}:${genre}`;
}
function loadCache(yearMonth: string, genre: string): ApiResponse | null {
  try {
    const raw = localStorage.getItem(cacheKey(yearMonth, genre));
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw) as { data: ApiResponse; savedAt: number };
    if (Date.now() - savedAt > CACHE_TTL_MS) { localStorage.removeItem(cacheKey(yearMonth, genre)); return null; }
    return data;
  } catch { return null; }
}
function saveCache(yearMonth: string, genre: string, data: ApiResponse) {
  try { localStorage.setItem(cacheKey(yearMonth, genre), JSON.stringify({ data, savedAt: Date.now() })); } catch {}
}

// ---- ページ ----
export default function MonthlyCandidatesPage() {
  const { openAlbum } = useGlobalReviewModal();
  const monthOptions = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value);
  const [selectedGenre, setSelectedGenre] = useState("all");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [addErrors, setAddErrors] = useState<Map<string, string>>(new Map());

  function updateAlbum(spotifyId: string, patch: Partial<AlbumCandidate>) {
    setResult((prev) =>
      prev ? { ...prev, albums: prev.albums.map((a) => a.spotifyId === spotifyId ? { ...a, ...patch } : a) } : prev
    );
  }

  async function fetchAndEnrich(yearMonth: string, genre: string, forceRefresh = false): Promise<ApiResponse> {
    const res = await fetch("/api/monthly-candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yearMonth, genre, forceRefresh }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
    const parsed = data as ApiResponse;

    // Spotify カバー + ID を取得
    const albumsWithCovers = await Promise.all(
      parsed.albums.map(async (album) => {
        try {
          const r = await fetch(`/api/spotify/search?q=${encodeURIComponent(album.spotifySearchQuery)}`);
          if (r.ok) {
            const results = await r.json();
            if (Array.isArray(results) && results.length > 0) {
              const hit = results[0];
              const spotifyId = hit.spotifyUrl ? (hit.spotifyUrl.match(SPOTIFY_ID_RE)?.[1] ?? undefined) : undefined;
              return { ...album, coverUrl: hit.coverUrl, spotifyUrl: hit.spotifyUrl, spotifyId };
            }
          }
        } catch {}
        return album;
      })
    );

    // Release Master 登録確認（Spotify ID がある分のみ）
    const albumsWithRM = await Promise.all(
      albumsWithCovers.map(async (album) => {
        if (!album.spotifyId) return album;
        try {
          const r = await fetch(`/api/sheets/check-album?spotifyId=${album.spotifyId}`);
          if (r.ok) {
            const { exists, no } = await r.json() as { exists: boolean; no?: string };
            return { ...album, rmNo: exists ? (no ?? "") : null };
          }
        } catch {}
        return album;
      })
    );

    return { ...parsed, albums: albumsWithRM };
  }

  async function handleSearch(forceRefresh = false) {
    setError(null);
    if (!forceRefresh) {
      const cached = loadCache(selectedMonth, selectedGenre);
      if (cached) { setResult(cached); setFromCache(true); return; }
    }
    setLoading(true);
    setResult(null);
    setFromCache(false);
    try {
      const enriched = await fetchAndEnrich(selectedMonth, selectedGenre, forceRefresh);
      saveCache(selectedMonth, selectedGenre, enriched);
      setResult(enriched);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(album: AlbumCandidate) {
    if (!album.spotifyId) return;
    const id = album.spotifyId;
    setAddingIds((prev) => new Set(prev).add(id));
    setAddErrors((prev) => { const m = new Map(prev); m.delete(id); return m; });
    try {
      // フル情報を Spotify から取得
      const albumRes = await fetch(`/api/spotify/album?id=${id}`);
      if (!albumRes.ok) throw new Error("Spotify情報の取得に失敗しました");
      const albumInfo = await albumRes.json();

      // Release Master に追加
      const addRes = await fetch("/api/sheets/add-album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(albumInfo),
      });
      const addData = await addRes.json();
      if (!addRes.ok) throw new Error(addData.error ?? "追加に失敗しました");

      updateAlbum(id, { rmNo: addData.no ?? "" });
      // キャッシュを無効化（rmNo が変わったため）
      localStorage.removeItem(cacheKey(selectedMonth, selectedGenre));
    } catch (e) {
      setAddErrors((prev) => new Map(prev).set(id, String(e)));
    } finally {
      setAddingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold mb-6 text-white">Monthly Selection 候補</h1>

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

        <button
          onClick={() => handleSearch(false)}
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors mb-8"
        >
          {loading ? "検索中…" : "候補を探す"}
        </button>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-900/30 border border-red-700/50 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {result && !loading && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-gray-500">{result.albums.length}件のアルバム候補</p>
              {fromCache && (
                <button
                  onClick={() => handleSearch(true)}
                  className="text-xs text-gray-500 underline hover:text-gray-300 transition-colors"
                >
                  キャッシュ済み — 再取得
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {result.albums.map((album, i) => (
                <AlbumCard
                  key={i}
                  album={album}
                  adding={!!album.spotifyId && addingIds.has(album.spotifyId)}
                  addError={album.spotifyId ? (addErrors.get(album.spotifyId) ?? null) : null}
                  onOpenReview={openAlbum}
                  onAdd={() => handleAdd(album)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
