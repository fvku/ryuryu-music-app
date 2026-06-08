"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";
import { reportColumnError } from "@/components/ColumnErrorIndicator";
import { useSpotifyPlayer } from "@/hooks/useSpotifyPlayer";
import { getSpotifyToken, saveSpotifyToken, openSpotifyAuthPopup } from "@/lib/spotify-token";

interface SpotifyTrack {
  trackNumber: number;
  name: string;
  durationMs: number;
  uri: string;
}

interface Props {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  spotifyUrl?: string;
  onClose: () => void;
  onSaved: (updated: Partial<ReleaseMasterAlbum>) => void;
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function getMjStyle(value: string) {
  const isAdopted = value.includes("採用") && !value.includes("不採用");
  return {
    backgroundColor: isAdopted ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
    color: isAdopted ? "var(--accent)" : "var(--text-secondary)",
  };
}

const ASSIGN_VALUES = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa", "Kaede", ""];

// 国名バリデーション用リスト（英語表記）
const COUNTRY_NAMES = new Set([
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria",
  "Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan",
  "Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia",
  "Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica",
  "Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt",
  "El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon",
  "Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana",
  "Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel",
  "Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar",
  "Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia",
  "Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal",
  "Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan",
  "Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar",
  "Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia",
  "Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa",
  "South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan",
  "Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan",
  "Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City",
  "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe","UK","USA","US",
].map((c) => c.toLowerCase()));

function isValidCountry(name: string): boolean {
  if (!name.trim()) return true; // 空は検証しない
  return COUNTRY_NAMES.has(name.trim().toLowerCase());
}

export default function MjWritingModal({ album, coverUrl, spotifyUrl, onClose, onSaved }: Props) {
  const [mounted, setMounted] = useState(false);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrack | null>(null);
  const [startTime, setStartTime] = useState<string>(() => album.mjStartTime?.trim() ?? "");
  const [text, setText] = useState<string>(() => album.mjText?.trim() ?? "");
  const [genreMemo, setGenreMemo] = useState<string>(() => album.genreMemo?.trim() ?? "");
  const [country, setCountry] = useState<string>(() => album.country?.trim() ?? "");
  const [countryError, setCountryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  // Spotify player
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [seekValue, setSeekValue] = useState<number | null>(null);
  const { isReady, isPaused, position, duration, sdkError, playTrack, togglePlay, commitSeek } =
    useSpotifyPlayer(spotifyToken);

  // ASSIGN
  const [currentAssign, setCurrentAssign] = useState(album.mjAssign?.trim() ?? "");
  const [assignPicker, setAssignPicker] = useState(false);
  const [assignPending, setAssignPending] = useState<string | null>(null);
  const [assignUpdating, setAssignUpdating] = useState(false);

  // プロップ経由のURL（spotifyDataキャッシュ）を優先し、なければアルバムオブジェクトのURLを使う
  const effectiveSpotifyUrl = spotifyUrl || album.spotifyUrl;

  useEffect(() => {
    setMounted(true);
    setSpotifyToken(getSpotifyToken());
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.cssText = `position: fixed; top: -${scrollY}px; width: 100%; overflow-y: scroll;`;
    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    if (!effectiveSpotifyUrl) return;
    setLoadingTracks(true);
    setTrackError(null);
    fetch(`/api/spotify/tracks?spotifyUrl=${encodeURIComponent(effectiveSpotifyUrl)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: SpotifyTrack[]) => {
        setTracks(data);
        const trackNoNum = album.mjTrackNo ? parseInt(album.mjTrackNo.trim(), 10) : NaN;
        const byNo = !isNaN(trackNoNum) ? data.find((t) => t.trackNumber === trackNoNum) ?? null : null;
        const byName = album.mjTrack?.trim() ? data.find((t) => t.name === album.mjTrack.trim()) ?? null : null;
        const found = byName ?? byNo ?? null;
        if (found) setSelectedTrack(found);
      })
      .catch((e: Error) => {
        setTrackError(e.message || "トラックを取得できませんでした");
        setTracks([]);
      })
      .finally(() => setLoadingTracks(false));
  }, [effectiveSpotifyUrl, album.mjTrackNo, album.mjTrack]);

  async function confirmAssignUpdate() {
    if (assignPending === null) return;
    setAssignUpdating(true);
    try {
      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mjAssign: assignPending, title: album.title, artist: album.artist }),
      });
      if (!res.ok) {
        const errData = await res.json();
        if (errData.errorCode === "COLUMN_NOT_FOUND") reportColumnError(errData.missing ?? []);
        throw new Error(errData.error || "更新失敗");
      }
      setCurrentAssign(assignPending);
      onSaved({ mjAssign: assignPending });
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setAssignUpdating(false);
      setAssignPending(null);
      setAssignPicker(false);
    }
  }

  async function handleSave() {
    // 国名バリデーション
    if (country.trim() && !isValidCountry(country)) {
      setCountryError("国名のスペルが正しくありません。英語表記で入力してください（例: Japan, United States）");
      return;
    }
    setCountryError(null);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: album.title,
          artist: album.artist,
          mjData: {
            trackNo: selectedTrack ? String(selectedTrack.trackNumber) : "",
            trackName: selectedTrack ? selectedTrack.name : "",
            startTime: startTime.trim(),
            mjText: text.trim(),
          },
          albumMeta: {
            genreMemo: genreMemo.trim(),
            country: country.trim(),
          },
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        if (errData.errorCode === "COLUMN_NOT_FOUND") reportColumnError(errData.missing ?? []);
        throw new Error(errData.error || "保存に失敗しました");
      }
      onSaved({
        mjTrackNo:   selectedTrack ? String(selectedTrack.trackNumber) : "",
        mjTrack:     selectedTrack ? selectedTrack.name : "",
        mjStartTime: startTime.trim(),
        mjText:      text.trim(),
        genreMemo:   genreMemo.trim(),
        country:     country.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  const charCount = text.length;
  const isValid = (text.trim().length > 0 || selectedTrack !== null) && charCount <= 300;

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
          style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
        >
          <div className="w-10 h-10" />
          <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
          <h2 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
            {text.length > 0 ? "M/J 文章を編集" : "M/J 文章を書く"}
          </h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-lg font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-6">
          {/* Album info — AlbumCard スタイル */}
          <div className="flex items-center gap-4 p-4 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
              {coverUrl ? (
                <Image src={coverUrl} alt={album.title} fill sizes="56px" className="object-cover" />
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
                  <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                    {album.genre}
                  </span>
                )}
                {album.mjAdoption && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={getMjStyle(album.mjAdoption)}>
                    {album.mjAdoption}
                  </span>
                )}
                {effectiveSpotifyUrl && (
                  <a
                    href={effectiveSpotifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ color: "#1DB954" }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    Spotify
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* ASSIGN */}
          <div>
            <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>担当者（ASSIGN）</h3>
            <div className="relative">
              <button
                type="button"
                onClick={() => setAssignPicker((v) => !v)}
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: currentAssign ? "rgba(251,191,36,0.15)" : "rgba(107,114,128,0.15)",
                  color: currentAssign ? "#fbbf24" : "#6b7280",
                  border: `1px solid ${currentAssign ? "rgba(251,191,36,0.3)" : "var(--border-subtle)"}`,
                }}
              >
                {currentAssign || "unassigned"}
                <span style={{ fontSize: "10px", opacity: 0.7 }}>✎</span>
              </button>

              {assignPicker && (
                <>
                  {/* 枠外タップで閉じるオーバーレイ */}
                  <div className="fixed inset-0 z-[105]" onClick={() => setAssignPicker(false)} />
                  <div
                    className="absolute left-0 top-full mt-1 rounded-xl border p-3 min-w-[200px]"
                    style={{ zIndex: 106, backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
                  >
                    <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>担当者を選択</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ASSIGN_VALUES.map((v) => (
                        <button
                          key={v || "__empty__"}
                          type="button"
                          onClick={() => { setAssignPending(v); setAssignPicker(false); }}
                          className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                          style={{
                            backgroundColor: v === currentAssign ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.08)",
                            color: v === currentAssign ? "#fbbf24" : "var(--text-secondary)",
                            border: `1px solid ${v === currentAssign ? "rgba(251,191,36,0.4)" : "var(--border-subtle)"}`,
                          }}
                        >
                          {v || "なし"}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Track selection */}
          <div>
            <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>
              おすすめトラック
            </h3>
            {selectedTrack && (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)" }}>
                <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>#{selectedTrack.trackNumber}</span>
                <span className="text-sm font-medium flex-1 truncate" style={{ color: "white" }}>{selectedTrack.name}</span>
                <button type="button" onClick={() => setSelectedTrack(null)} className="text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--text-secondary)" }}>外す</button>
              </div>
            )}
            {!effectiveSpotifyUrl ? (
              <p className="text-xs py-2" style={{ color: "var(--text-secondary)" }}>Spotifyリンクなし</p>
            ) : loadingTracks ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>トラックを読み込み中...</span>
              </div>
            ) : trackError ? (
              <p className="text-xs py-2" style={{ color: "#ef4444" }}>トラック取得エラー: {trackError}</p>
            ) : tracks.length === 0 ? (
              <p className="text-xs py-2" style={{ color: "var(--text-secondary)" }}>トラックが見つかりません</p>
            ) : (
              <div className="rounded-xl border overflow-hidden max-h-44 overflow-y-auto" style={{ borderColor: "var(--border-subtle)" }}>
                {tracks.map((track) => {
                  const isSelected = selectedTrack?.trackNumber === track.trackNumber;
                  return (
                    <button
                      key={track.trackNumber}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedTrack(null);
                        } else {
                          setSelectedTrack(track);
                          if (isReady && track.uri) playTrack(track.uri);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                      style={{ backgroundColor: isSelected ? "rgba(139,92,246,0.15)" : "transparent" }}
                    >
                      <span className="w-5 text-xs text-right flex-shrink-0" style={{ color: isSelected ? "var(--accent)" : "var(--text-secondary)" }}>
                        {track.trackNumber}
                      </span>
                      <span className="flex-1 text-xs truncate" style={{ color: isSelected ? "white" : "var(--text-primary)" }}>
                        {track.name}
                      </span>
                      <span className="text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
                        {formatDuration(track.durationMs)}
                      </span>
                      {isSelected && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Start Time */}
          {selectedTrack && (
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>再生開始位置</h3>

              {/* 現在の設定値 — 常に表示・直接編集可 */}
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  placeholder="例: 0:30"
                  className="w-28 px-3 py-2 rounded-xl border text-sm font-mono focus:outline-none focus:border-violet-500/50"
                  style={{
                    backgroundColor: "#0d0d14",
                    borderColor: startTime ? "rgba(139,92,246,0.4)" : "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                />
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {startTime ? "セット済み（直接編集可）" : "未設定"}
                </p>
              </div>

              {/* Spotifyプレイヤー（接続済みの場合） */}
              {!spotifyToken ? (
                <div className="rounded-2xl border p-4 flex flex-col items-center gap-2.5 text-center"
                  style={{ borderColor: "var(--border-subtle)", backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    曲を聴きながら開始位置を設定できます
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setConnectingSpotify(true);
                      openSpotifyAuthPopup(
                        (token, expiresIn) => {
                          saveSpotifyToken(token, expiresIn);
                          setSpotifyToken(token);
                          setConnectingSpotify(false);
                        },
                        () => setConnectingSpotify(false)
                      );
                    }}
                    disabled={connectingSpotify}
                    className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-full font-bold transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: "#1DB954", color: "white" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    {connectingSpotify ? "接続中..." : "Spotifyで接続して設定する"}
                  </button>
                  <p className="text-xs" style={{ color: "var(--text-secondary)", opacity: 0.6 }}>
                    Spotify Premium が必要です
                  </p>
                </div>

              ) : sdkError ? (
                <p className="text-xs" style={{ color: "#ef4444" }}>{sdkError}</p>

              ) : !isReady ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0"
                    style={{ borderColor: "#1DB954", borderTopColor: "transparent" }} />
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Spotifyプレイヤー初期化中...</span>
                </div>

              ) : (
                // SDKプレイヤー
                <div className="rounded-2xl border p-4 space-y-3"
                  style={{ backgroundColor: "rgba(29,185,84,0.04)", borderColor: "rgba(29,185,84,0.2)" }}>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isPaused) { togglePlay(); return; }
                        if (duration > 0 || position > 0) { togglePlay(); } else { playTrack(selectedTrack.uri); }
                      }}
                      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80"
                      style={{ backgroundColor: "#1DB954", color: "white" }}
                    >
                      {isPaused ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                      )}
                    </button>
                    <span className="font-mono text-sm tabular-nums w-10 flex-shrink-0" style={{ color: "var(--text-primary)" }}>
                      {formatDuration(position)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={duration || 1}
                      value={seekValue ?? position}
                      onChange={(e) => setSeekValue(Number(e.target.value))}
                      onMouseUp={(e) => {
                        const ms = Number((e.target as HTMLInputElement).value);
                        commitSeek(ms);
                        setSeekValue(null);
                      }}
                      onTouchEnd={(e) => {
                        const ms = Number((e.target as HTMLInputElement).value);
                        commitSeek(ms);
                        setSeekValue(null);
                      }}
                      className="flex-1"
                      style={{ accentColor: "#1DB954" }}
                    />
                    <span className="font-mono text-xs tabular-nums w-10 text-right flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {formatDuration(duration)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStartTime(formatDuration(position))}
                    className="w-full py-2.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-80"
                    style={{ backgroundColor: "rgba(29,185,84,0.18)", color: "#1DB954", border: "1px solid rgba(29,185,84,0.3)" }}
                  >
                    この位置をStart Timeとしてセット（{formatDuration(position)}）
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Genre memo / 国 */}
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-bold mb-2" style={{ color: "var(--text-primary)" }}>ジャンル / メモ（K列）</h3>
              <input
                type="text"
                value={genreMemo}
                onChange={(e) => setGenreMemo(e.target.value)}
                placeholder="例: indie rock, jazz, city pop..."
                className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50"
                style={{
                  backgroundColor: "#0d0d14",
                  borderColor: genreMemo ? "rgba(139,92,246,0.4)" : "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            <div>
              <h3 className="text-xs font-bold mb-2" style={{ color: "var(--text-primary)" }}>国（L列）</h3>
              <input
                type="text"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  if (countryError) setCountryError(null);
                }}
                onBlur={() => {
                  if (country.trim() && !isValidCountry(country)) {
                    setCountryError("国名のスペルが正しくありません（例: Japan, United States, United Kingdom）");
                  } else {
                    setCountryError(null);
                  }
                }}
                placeholder="例: Japan, United States, United Kingdom..."
                className="w-full px-3 py-2 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50"
                style={{
                  backgroundColor: "#0d0d14",
                  borderColor: countryError ? "rgba(239,68,68,0.5)" : country && isValidCountry(country) ? "rgba(139,92,246,0.4)" : "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              />
              {countryError && (
                <p className="text-xs mt-1.5 px-1" style={{ color: "#ef4444" }}>{countryError}</p>
              )}
            </div>
          </div>

          {/* Text editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>M/J 文章</h3>
              <span
                className="text-xs font-medium tabular-nums"
                style={{ color: charCount > 300 ? "#ef4444" : charCount >= 220 ? "#22c55e" : "var(--text-secondary)" }}
              >
                {charCount} / 300
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="220〜300字程度で文章を書いてください..."
              rows={9}
              className="w-full px-4 py-3 rounded-xl border text-sm leading-relaxed resize-none focus:outline-none focus:border-violet-500/50"
              style={{
                backgroundColor: "#0d0d14",
                borderColor: charCount > 300 ? "rgba(239,68,68,0.5)" : charCount >= 220 ? "rgba(34,197,94,0.4)" : "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            />
            <div className="flex justify-between items-center mt-1.5">
              {charCount > 0 && charCount < 220 ? (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>あと {220 - charCount} 字で最低文字数に達します</p>
              ) : charCount > 300 ? (
                <p className="text-xs" style={{ color: "#ef4444" }}>{charCount - 300} 字超過しています</p>
              ) : charCount >= 220 ? (
                <p className="text-xs" style={{ color: "#22c55e" }}>文字数OK</p>
              ) : <span />}
            </div>
          </div>

          {error && <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>}

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isValid}
            className="w-full py-3.5 rounded-2xl font-bold text-sm transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>

      {/* ASSIGN 確認ダイアログ */}
      {assignPending !== null && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div className="rounded-2xl p-6 w-full max-w-xs border" style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}>
            <p className="font-bold text-sm mb-1" style={{ color: "var(--text-primary)" }}>担当者を変更しますか？</p>
            <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--text-primary)" }}>{currentAssign || "なし"}</span>
              {" → "}
              <span style={{ color: "#fbbf24", fontWeight: 600 }}>{assignPending || "なし"}</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setAssignPending(null)}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <button
                onClick={confirmAssignUpdate}
                disabled={assignUpdating}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)", color: "white" }}
              >
                {assignUpdating ? "更新中..." : "変更する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
