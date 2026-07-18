"use client";

import { SpotifyTrack } from "@/hooks/useMjTracks";
import { UseSpotifyPlayerReturn } from "@/hooks/useSpotifyPlayer";
import { formatDuration } from "./utils";

interface SpotifyPlayerPanelProps {
  selectedTrack: SpotifyTrack;
  spotifyToken: string | null;
  connectingSpotify: boolean;
  onConnect: () => void;
  player: UseSpotifyPlayerReturn;
  seekValue: number | null;
  onSeekChange: (ms: number) => void;
  onSeekCommit: (ms: number) => void;
  onSetStartTime: (formatted: string) => void;
}

/** 未接続/エラー/初期化中/シークバー付きSDKプレイヤーのハイブリッド入力部分 */
export default function SpotifyPlayerPanel({
  selectedTrack,
  spotifyToken,
  connectingSpotify,
  onConnect,
  player,
  seekValue,
  onSeekChange,
  onSeekCommit,
  onSetStartTime,
}: SpotifyPlayerPanelProps) {
  const { isReady, isPaused, position, duration, sdkError, playTrack, togglePlay } = player;

  if (!spotifyToken) {
    return (
      <div className="rounded-2xl border p-4 flex flex-col items-center gap-2.5 text-center"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "rgba(255,255,255,0.03)" }}>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          曲を聴きながら開始位置を設定できます
        </p>
        <button
          type="button"
          onClick={onConnect}
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
    );
  }

  if (sdkError) {
    return <p className="text-xs" style={{ color: "#ef4444" }}>{sdkError}</p>;
  }

  if (!isReady) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0"
          style={{ borderColor: "#1DB954", borderTopColor: "transparent" }} />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Spotifyプレイヤー初期化中...</span>
      </div>
    );
  }

  return (
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
          onChange={(e) => onSeekChange(Number(e.target.value))}
          onMouseUp={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => onSeekCommit(Number((e.target as HTMLInputElement).value))}
          className="flex-1"
          style={{ accentColor: "#1DB954" }}
        />
        <span className="font-mono text-xs tabular-nums w-10 text-right flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
          {formatDuration(duration)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSetStartTime(formatDuration(position))}
        className="w-full py-2.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-80"
        style={{ backgroundColor: "rgba(29,185,84,0.18)", color: "#1DB954", border: "1px solid rgba(29,185,84,0.3)" }}
      >
        この位置をStart Timeとしてセット（{formatDuration(position)}）
      </button>
    </div>
  );
}
