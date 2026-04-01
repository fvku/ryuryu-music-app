"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { SpotifyAlbum } from "@/lib/types";

type Step = "auth" | "main";
type SearchMode = "spotify" | "release-master";

interface ReleaseMasterAlbum {
  no: string;
  date: string;
  title: string;
  artist: string;
  genre: "邦楽" | "洋楽" | "";
}

export default function AdminPage() {
  const [step, setStep] = useState<Step>("auth");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Search mode
  const [searchMode, setSearchMode] = useState<SearchMode>("release-master");

  // Spotify search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SpotifyAlbum[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Release Master
  const [rmAlbums, setRmAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [rmLoading, setRmLoading] = useState(false);
  const [rmError, setRmError] = useState<string | null>(null);
  const [rmFilter, setRmFilter] = useState("");

  // Selected album
  const [selectedAlbum, setSelectedAlbum] = useState<SpotifyAlbum | null>(null);
  const [genre, setGenre] = useState<"邦楽" | "洋楽" | "">("");

  // Year/Month
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // Create review
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (step === "main" && searchMode === "release-master" && rmAlbums.length === 0) {
      fetchReleaseMaster();
    }
  }, [step, searchMode]);

  async function fetchReleaseMaster() {
    setRmLoading(true);
    setRmError(null);
    try {
      const res = await fetch("/api/release-master");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取得に失敗しました");
      setRmAlbums(data);
    } catch (err) {
      setRmError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setRmLoading(false);
    }
  }

  async function searchSpotify(query: string) {
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    setSelectedAlbum(null);
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "検索に失敗しました");
      setSearchResults(data);
      if (data.length === 0) setSearchError("アルバムが見つかりませんでした");
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "検索に失敗しました");
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setAuthError("パスワードを入力してください");
      return;
    }
    setAuthLoading(true);
    setStep("main");
    setAuthLoading(false);
  }

  async function handleSpotifySearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    await searchSpotify(searchQuery);
  }

  function handleSelectFromReleaseMaster(album: ReleaseMasterAlbum) {
    const query = `${album.artist} ${album.title}`;
    setSearchQuery(query);
    setGenre(album.genre as "邦楽" | "洋楽" | "");
    setSearchMode("spotify");
    searchSpotify(query);
  }

  async function handleCreateReview() {
    if (!selectedAlbum) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, spotifyAlbum: selectedAlbum, year, month, genre }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setStep("auth");
          setAuthError("パスワードが正しくありません");
          return;
        }
        throw new Error(data.error || "レビューの作成に失敗しました");
      }
      setCreateSuccess(true);
      setCreatedId(data.id);
      setSelectedAlbum(null);
      setSearchResults([]);
      setSearchQuery("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setCreateLoading(false);
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const filteredRmAlbums = rmAlbums.filter(
    (a) =>
      a.title.toLowerCase().includes(rmFilter.toLowerCase()) ||
      a.artist.toLowerCase().includes(rmFilter.toLowerCase())
  );

  if (step === "auth") {
    return (
      <div className="max-w-sm mx-auto mt-16">
        <div className="rounded-2xl p-8 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <div className="text-center mb-6">
            <span className="text-4xl">🔐</span>
            <h1 className="mt-3 text-xl font-bold" style={{ color: "var(--text-primary)" }}>管理者ログイン</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>管理者パスワードを入力してください</p>
          </div>
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none"
              style={{ backgroundColor: "#12121a", borderColor: authError ? "rgba(239,68,68,0.5)" : "var(--border-subtle)", color: "var(--text-primary)" }}
            />
            {authError && <p className="text-red-400 text-sm">{authError}</p>}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {authLoading ? "確認中..." : "ログイン"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>管理者ページ</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>今月のアルバムを登録してください</p>
        </div>
        <button
          onClick={() => { setStep("auth"); setPassword(""); setCreateSuccess(false); }}
          className="text-sm px-4 py-2 rounded-xl border"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          ログアウト
        </button>
      </div>

      {createSuccess && createdId && (
        <div className="rounded-2xl p-5 mb-6 border flex items-center justify-between" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
          <div>
            <p className="text-green-400 font-medium">レビューを作成しました！</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>メンバーはレビューページからスコアを投稿できます</p>
          </div>
          <a href={`/review/${createdId}`} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ backgroundColor: "var(--accent)", color: "white" }}>
            レビューを見る
          </a>
        </div>
      )}

      {/* Year/Month selector */}
      <div className="rounded-2xl p-6 border mb-6" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        <h2 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>対象月</h2>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>年</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>
              {years.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>月</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>
              {months.map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="rounded-2xl border mb-6 overflow-hidden" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        <div className="flex border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <button
            onClick={() => setSearchMode("release-master")}
            className="flex-1 py-3 text-sm font-medium transition-colors"
            style={{
              color: searchMode === "release-master" ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: searchMode === "release-master" ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            Release Masterから選択
          </button>
          <button
            onClick={() => setSearchMode("spotify")}
            className="flex-1 py-3 text-sm font-medium transition-colors"
            style={{
              color: searchMode === "spotify" ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: searchMode === "spotify" ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            Spotifyで検索
          </button>
        </div>

        <div className="p-6">
          {/* Release Master tab */}
          {searchMode === "release-master" && (
            <div>
              <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                アルバムを選択すると自動でSpotifyを検索します
              </p>
              <input
                type="text"
                value={rmFilter}
                onChange={(e) => setRmFilter(e.target.value)}
                placeholder="タイトルまたはアーティストで絞り込み"
                className="w-full px-4 py-2 rounded-xl border text-sm mb-4 focus:outline-none"
                style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
              />
              {rmLoading && (
                <p className="text-sm text-center py-8" style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
              )}
              {rmError && <p className="text-red-400 text-sm">{rmError}</p>}
              {!rmLoading && filteredRmAlbums.length === 0 && !rmError && (
                <p className="text-sm text-center py-8" style={{ color: "var(--text-secondary)" }}>データがありません</p>
              )}
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                {filteredRmAlbums.map((album, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectFromReleaseMaster(album)}
                    className="flex items-center gap-4 px-4 py-3 rounded-xl border text-left transition-colors hover:border-violet-500/50"
                    style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)" }}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ backgroundColor: "var(--accent)", color: "white" }}>
                      {album.no || "?"}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
                      <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{album.artist}</p>
                    </div>
                    {album.date && (
                      <p className="text-xs ml-auto flex-shrink-0" style={{ color: "var(--text-secondary)" }}>{album.date}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Spotify search tab */}
          {searchMode === "spotify" && (
            <div>
              <form onSubmit={handleSpotifySearch} className="flex gap-3 mb-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="アーティスト名またはアルバム名"
                  className="flex-1 px-4 py-2 rounded-xl border text-sm focus:outline-none"
                  style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
                />
                <button
                  type="submit"
                  disabled={searchLoading || !searchQuery.trim()}
                  className="px-5 py-2 rounded-xl font-medium text-sm disabled:opacity-50"
                  style={{ backgroundColor: "var(--accent)", color: "white" }}
                >
                  {searchLoading ? "検索中..." : "検索"}
                </button>
              </form>

              {searchError && <p className="text-red-400 text-sm mb-4">{searchError}</p>}

              {searchLoading && (
                <p className="text-sm text-center py-8" style={{ color: "var(--text-secondary)" }}>Spotifyを検索中...</p>
              )}

              {searchResults.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {searchResults.map((album) => (
                    <button
                      key={album.id}
                      onClick={() => setSelectedAlbum(album)}
                      className={`rounded-xl overflow-hidden border text-left transition-all ${selectedAlbum?.id === album.id ? "ring-2 ring-violet-500" : ""}`}
                      style={{ backgroundColor: selectedAlbum?.id === album.id ? "#22223a" : "#12121a", borderColor: selectedAlbum?.id === album.id ? "var(--accent)" : "var(--border-subtle)" }}
                    >
                      <div className="relative aspect-square w-full">
                        {album.coverUrl ? (
                          <Image src={album.coverUrl} alt={album.name} fill sizes="150px" className="object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: "#2a2a3a" }}>
                            <span className="text-2xl">💿</span>
                          </div>
                        )}
                        {selectedAlbum?.id === album.id && (
                          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(139,92,246,0.4)" }}>
                            <span className="text-2xl text-white">✓</span>
                          </div>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{album.name}</p>
                        <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{album.artist}</p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.releaseYear}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Selected album confirmation */}
      {selectedAlbum && (
        <div className="rounded-2xl p-6 border mb-6" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-accent)" }}>
          <h2 className="font-semibold mb-4" style={{ color: "var(--text-primary)" }}>選択されたアルバム</h2>
          <div className="flex gap-4 items-start">
            <div className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0">
              {selectedAlbum.coverUrl ? (
                <Image src={selectedAlbum.coverUrl} alt={selectedAlbum.name} fill sizes="80px" className="object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: "#2a2a3a" }}>
                  <span className="text-xl">💿</span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base truncate" style={{ color: "var(--text-primary)" }}>{selectedAlbum.name}</p>
              <p className="text-sm mt-1 truncate" style={{ color: "var(--accent)" }}>{selectedAlbum.artist}</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{selectedAlbum.releaseYear}年 · {year}年{month}月のレビューとして登録</p>
              <div className="flex gap-2 mt-2">
                {(["邦楽", "洋楽"] as const).map((g) => (
                  <button key={g} type="button" onClick={() => setGenre(g)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                    style={{ backgroundColor: genre === g ? "var(--accent)" : "rgba(255,255,255,0.08)", color: genre === g ? "white" : "var(--text-secondary)", border: `1px solid ${genre === g ? "var(--accent)" : "var(--border-subtle)"}` }}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {createError && <p className="text-red-400 text-sm mt-4">{createError}</p>}

          <div className="flex gap-3 mt-5">
            <button
              onClick={() => setSelectedAlbum(null)}
              className="flex-1 py-3 rounded-xl font-medium text-sm border"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              キャンセル
            </button>
            <button
              onClick={handleCreateReview}
              disabled={createLoading}
              className="flex-1 py-3 rounded-xl font-medium text-sm disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {createLoading ? "作成中..." : "レビューを作成する"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
