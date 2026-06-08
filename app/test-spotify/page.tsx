"use client";

import { useSession, signIn } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Spotify: any;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

const TEST_SPOTIFY_URL = "https://open.spotify.com/album/7GVpOkI5do8Hb8NOtqb39y";
const ASSIGN_VALUES = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa", "Kaede", ""];

interface SpotifyTrack {
  trackNumber: number;
  name: string;
  durationMs: number;
  uri: string;
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function getMjStyle(value: string) {
  const isAdopted = value.includes("採用") && !value.includes("不採用");
  return {
    backgroundColor: isAdopted ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
    color: isAdopted ? "var(--accent)" : "var(--text-secondary)",
  };
}

const INITIAL_ALBUM: ReleaseMasterAlbum = {
  no: "TEST", date: "", title: "読み込み中...", artist: "", genre: "",
  genreMemo: "", country: "",
  mjAdoption: "M/J採用", mjAssign: "", mjTrackNo: "", mjTrack: "",
  mjStartTime: "", mjText: "", legacyScores: [],
  spotifyUrl: TEST_SPOTIFY_URL, coverUrl: "",
};

export default function TestSpotifyPage() {
  const { data: session } = useSession();
  const spotifyToken = (session as Record<string, unknown> | null)?.spotifyAccessToken as string | undefined;

  const [album, setAlbum] = useState<ReleaseMasterAlbum>(INITIAL_ALBUM);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrack | null>(null);

  const [startTime, setStartTime] = useState("");
  const [text, setText] = useState("");
  const [currentAssign, setCurrentAssign] = useState("");
  const [assignPicker, setAssignPicker] = useState(false);
  const [assignPending, setAssignPending] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [player, setPlayer] = useState<any>(null);
  const [deviceId, setDeviceId] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sdkError, setSdkError] = useState("");
  const isSeeking = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [savedResult, setSavedResult] = useState<Record<string, string> | null>(null);

  // アルバム情報取得
  useEffect(() => {
    fetch(`/api/spotify/album?url=${encodeURIComponent(TEST_SPOTIFY_URL)}`)
      .then(r => r.json())
      .then(data => {
        setAlbum(prev => ({
          ...prev,
          title: data.name ?? prev.title,
          artist: data.artist ?? prev.artist,
          date: data.releaseYear ?? prev.date,
          coverUrl: data.coverUrl ?? prev.coverUrl,
        }));
      })
      .catch(() => {});
  }, []);

  // トラック一覧取得
  useEffect(() => {
    setLoadingTracks(true);
    setTrackError(null);
    fetch(`/api/spotify/tracks?spotifyUrl=${encodeURIComponent(TEST_SPOTIFY_URL)}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `HTTP ${r.status}`);
        }
        return r.json() as Promise<SpotifyTrack[]>;
      })
      .then(data => setTracks(data))
      .catch((e: Error) => setTrackError(e.message))
      .finally(() => setLoadingTracks(false));
  }, []);

  // Spotify Web Playback SDK 初期化
  useEffect(() => {
    if (!spotifyToken) return;

    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: "ryuryu-music MJ writer",
        getOAuthToken: (cb: (token: string) => void) => cb(spotifyToken),
        volume: 0.7,
      });

      p.addListener("ready", ({ device_id }: { device_id: string }) => {
        setDeviceId(device_id);
        setIsReady(true);
        setPlayer(p);
      });
      p.addListener("not_ready", () => setIsReady(false));
      p.addListener("player_state_changed", (state: Record<string, unknown> | null) => {
        if (!state) return;
        setIsPaused(state.paused as boolean);
        if (!isSeeking.current) setPosition(state.position as number);
        setDuration((state.duration as number) ?? 0);
      });
      p.addListener("initialization_error", ({ message }: { message: string }) => setSdkError(`初期化エラー: ${message}`));
      p.addListener("authentication_error", ({ message }: { message: string }) => setSdkError(`認証エラー: ${message}`));
      p.addListener("account_error", ({ message }: { message: string }) => setSdkError(`アカウントエラー（Premium必須）: ${message}`));

      p.connect();
    };

    return () => {
      if (document.body.contains(script)) document.body.removeChild(script);
    };
  }, [spotifyToken]);

  // 再生中は 500ms ごとに位置を更新
  useEffect(() => {
    if (!player || isPaused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(async () => {
      if (isSeeking.current) return;
      const state = await player.getCurrentState();
      if (state) setPosition(state.position as number);
    }, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [player, isPaused]);

  async function playTrack(track: SpotifyTrack) {
    if (!deviceId || !spotifyToken) return;
    setSdkError("");
    const res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${spotifyToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [track.uri] }),
      }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      setSdkError(`再生エラー: ${(body as { error?: { message?: string } })?.error?.message ?? res.status}`);
    }
  }

  function handleSeekCommit(ms: number) {
    isSeeking.current = false;
    setPosition(ms);
    player?.seek(ms);
  }

  const charCount = text.length;
  const isValid = (text.trim().length > 0 || selectedTrack !== null) && charCount <= 300;

  return (
    <div className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: "var(--bg-primary)" }}>
      <div className="max-w-lg mx-auto">

        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
            {text.length > 0 ? "M/J 文章を編集" : "M/J 文章を書く"}
            <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(255,200,0,0.15)", color: "#fbbf24" }}>
              テスト
            </span>
          </h1>
          {!spotifyToken ? (
            <button
              onClick={() => signIn("spotify")}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ backgroundColor: "#1DB954", color: "white" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              Spotifyでログイン
            </button>
          ) : (
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ backgroundColor: "rgba(29,185,84,0.12)", color: "#1DB954" }}>
              ● Spotify接続済み
            </span>
          )}
        </div>

        <div className="flex flex-col gap-6">

          {/* アルバム情報 */}
          <div className="flex items-center gap-4 p-4 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
            <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
              {album.coverUrl ? (
                <Image src={album.coverUrl} alt={album.title} fill sizes="56px" className="object-cover" />
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
                {album.date && <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>}
                {album.mjAdoption && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={getMjStyle(album.mjAdoption)}>
                    {album.mjAdoption}
                  </span>
                )}
                <a href={TEST_SPOTIFY_URL} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium hover:opacity-80 transition-opacity"
                  style={{ color: "#1DB954" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                  </svg>
                  Spotify
                </a>
              </div>
            </div>
          </div>

          {/* ASSIGN */}
          <div>
            <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>担当者（ASSIGN）</h3>
            <div className="relative">
              <button
                type="button"
                onClick={() => setAssignPicker(v => !v)}
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
                  <div className="fixed inset-0 z-[105]" onClick={() => setAssignPicker(false)} />
                  <div className="absolute left-0 top-full mt-1 rounded-xl border p-3 min-w-[200px]"
                    style={{ zIndex: 106, backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                    <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>担当者を選択</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ASSIGN_VALUES.map(v => (
                        <button key={v || "__empty__"} type="button"
                          onClick={() => { setAssignPending(v); setAssignPicker(false); }}
                          className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                          style={{
                            backgroundColor: v === currentAssign ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.08)",
                            color: v === currentAssign ? "#fbbf24" : "var(--text-secondary)",
                            border: `1px solid ${v === currentAssign ? "rgba(251,191,36,0.4)" : "var(--border-subtle)"}`,
                          }}>
                          {v || "なし"}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* おすすめトラック */}
          <div>
            <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>おすすめトラック</h3>

            {selectedTrack && (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl"
                style={{ backgroundColor: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)" }}>
                <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>#{selectedTrack.trackNumber}</span>
                <span className="text-sm font-medium flex-1 truncate" style={{ color: "white" }}>{selectedTrack.name}</span>
                <button type="button"
                  onClick={() => { setSelectedTrack(null); setStartTime(""); setPosition(0); setDuration(0); }}
                  className="text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--text-secondary)" }}>
                  外す
                </button>
              </div>
            )}

            {loadingTracks ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0"
                  style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>トラックを読み込み中...</span>
              </div>
            ) : trackError ? (
              <p className="text-xs py-2" style={{ color: "#ef4444" }}>トラック取得エラー: {trackError}</p>
            ) : (
              <div className="rounded-xl border overflow-hidden max-h-44 overflow-y-auto" style={{ borderColor: "var(--border-subtle)" }}>
                {tracks.map(track => {
                  const isSelected = selectedTrack?.trackNumber === track.trackNumber;
                  return (
                    <button key={track.trackNumber} type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedTrack(null);
                          setStartTime("");
                          setPosition(0);
                          setDuration(0);
                        } else {
                          setSelectedTrack(track);
                          setStartTime("");
                          if (isReady) playTrack(track);
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                      style={{ backgroundColor: isSelected ? "rgba(139,92,246,0.15)" : "transparent" }}>
                      <span className="w-5 text-xs text-right flex-shrink-0"
                        style={{ color: isSelected ? "var(--accent)" : "var(--text-secondary)" }}>
                        {track.trackNumber}
                      </span>
                      <span className="flex-1 text-xs truncate"
                        style={{ color: isSelected ? "white" : "var(--text-primary)" }}>
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

          {/* 再生開始位置 */}
          {selectedTrack && (
            <div>
              <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>再生開始位置</h3>

              {!spotifyToken ? (
                // Spotify未ログイン時はテキスト入力にフォールバック
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input type="text" value={startTime} onChange={e => setStartTime(e.target.value)}
                      placeholder="例: 0:30"
                      className="w-28 px-3 py-2 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50"
                      style={{ backgroundColor: "#0d0d14", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }} />
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {selectedTrack.name} の再生開始時間
                    </p>
                  </div>
                  <button onClick={() => signIn("spotify")}
                    className="text-xs px-3 py-1.5 rounded-full font-medium"
                    style={{ backgroundColor: "#1DB954", color: "white" }}>
                    Spotifyでログインして曲を聴きながら設定する
                  </button>
                </div>

              ) : sdkError ? (
                <p className="text-xs py-2" style={{ color: "#ef4444" }}>{sdkError}</p>

              ) : !isReady ? (
                <div className="flex items-center gap-2 py-2">
                  <div className="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0"
                    style={{ borderColor: "#1DB954", borderTopColor: "transparent" }} />
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Spotifyプレイヤー初期化中...</span>
                </div>

              ) : (
                // SDKプレイヤー
                <div className="rounded-2xl border p-4 space-y-3"
                  style={{ backgroundColor: "rgba(29,185,84,0.04)", borderColor: "rgba(29,185,84,0.2)" }}>

                  {/* 再生コントロール */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => isPaused ? playTrack(selectedTrack) : player?.togglePlay()}
                      className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80"
                      style={{ backgroundColor: "#1DB954", color: "white" }}>
                      {isPaused ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                        </svg>
                      )}
                    </button>

                    <span className="font-mono text-sm tabular-nums w-10 flex-shrink-0" style={{ color: "var(--text-primary)" }}>
                      {formatTime(position)}
                    </span>

                    <input
                      type="range"
                      min={0}
                      max={duration || 1}
                      value={position}
                      onChange={e => {
                        isSeeking.current = true;
                        setPosition(Number(e.target.value));
                      }}
                      onMouseUp={e => handleSeekCommit(Number((e.target as HTMLInputElement).value))}
                      onTouchEnd={e => handleSeekCommit(Number((e.target as HTMLInputElement).value))}
                      className="flex-1"
                      style={{ accentColor: "#1DB954" }}
                    />

                    <span className="font-mono text-xs tabular-nums w-10 text-right flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {formatTime(duration)}
                    </span>
                  </div>

                  {/* セットボタン */}
                  <button
                    onClick={() => setStartTime(formatTime(position))}
                    className="w-full py-2.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-80"
                    style={{ backgroundColor: "rgba(29,185,84,0.18)", color: "#1DB954", border: "1px solid rgba(29,185,84,0.3)" }}>
                    この位置をStart Timeとしてセット（{formatTime(position)}）
                  </button>

                  {/* セット済み表示 */}
                  {startTime && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                      style={{ backgroundColor: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)" }}>
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Start Time</span>
                      <span className="font-mono text-sm font-bold" style={{ color: "var(--accent)" }}>{startTime}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* M/J 文章 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>M/J 文章</h3>
              <span className="text-xs font-medium tabular-nums"
                style={{ color: charCount > 300 ? "#ef4444" : charCount >= 220 ? "#22c55e" : "var(--text-secondary)" }}>
                {charCount} / 300
              </span>
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="220〜300字程度で文章を書いてください..."
              rows={9}
              className="w-full px-4 py-3 rounded-xl border text-sm leading-relaxed resize-none focus:outline-none focus:border-violet-500/50"
              style={{
                backgroundColor: "#0d0d14",
                borderColor: charCount > 300 ? "rgba(239,68,68,0.5)" : charCount >= 220 ? "rgba(34,197,94,0.4)" : "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            />
            <div className="mt-1.5">
              {charCount > 0 && charCount < 220 ? (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>あと {220 - charCount} 字で最低文字数に達します</p>
              ) : charCount > 300 ? (
                <p className="text-xs" style={{ color: "#ef4444" }}>{charCount - 300} 字超過しています</p>
              ) : charCount >= 220 ? (
                <p className="text-xs" style={{ color: "#22c55e" }}>文字数OK</p>
              ) : null}
            </div>
          </div>

          {/* 保存ボタン（テスト用） */}
          <button
            type="button"
            onClick={() => setSavedResult({
              trackNo: selectedTrack ? String(selectedTrack.trackNumber) : "",
              trackName: selectedTrack?.name ?? "",
              startTime: startTime.trim(),
              mjText: text.trim(),
              mjAssign: currentAssign,
            })}
            disabled={!isValid}
            className="w-full py-3.5 rounded-2xl font-bold text-sm transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            保存内容を確認する（テスト）
          </button>

          {/* 結果表示 */}
          {savedResult && (
            <div className="rounded-xl border p-4 space-y-2"
              style={{ backgroundColor: "rgba(34,197,94,0.05)", borderColor: "rgba(34,197,94,0.2)" }}>
              <p className="text-xs font-bold mb-2" style={{ color: "#22c55e" }}>保存される内容（テスト確認）</p>
              {Object.entries(savedResult).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="w-24 flex-shrink-0 font-medium" style={{ color: "var(--text-secondary)" }}>{k}</span>
                  <span className="font-mono" style={{ color: "var(--text-primary)" }}>{v || "(空)"}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* ASSIGN 確認ダイアログ */}
      {assignPending !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="rounded-2xl p-6 w-full max-w-xs border"
            style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}>
            <p className="font-bold text-sm mb-1" style={{ color: "var(--text-primary)" }}>担当者を変更しますか？</p>
            <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--text-primary)" }}>{currentAssign || "なし"}</span>
              {" → "}
              <span style={{ color: "#fbbf24", fontWeight: 600 }}>{assignPending || "なし"}</span>
            </p>
            <div className="flex gap-3">
              <button onClick={() => setAssignPending(null)}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                キャンセル
              </button>
              <button
                onClick={() => { setCurrentAssign(assignPending ?? ""); setAssignPending(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ backgroundColor: "var(--accent)", color: "white" }}>
                変更する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
