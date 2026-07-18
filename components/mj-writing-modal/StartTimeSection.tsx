"use client";

import { SpotifyTrack } from "@/hooks/useMjTracks";
import { UseSpotifyPlayerReturn } from "@/hooks/useSpotifyPlayer";
import SpotifyPlayerPanel from "./SpotifyPlayerPanel";

interface StartTimeSectionProps {
  selectedTrack: SpotifyTrack;
  startTime: string;
  onStartTimeChange: (value: string) => void;
  spotifyToken: string | null;
  connectingSpotify: boolean;
  onConnect: () => void;
  player: UseSpotifyPlayerReturn;
  seekValue: number | null;
  onSeekChange: (ms: number) => void;
  onSeekCommit: (ms: number) => void;
}

/** Start Timeテキスト入力＋Spotifyシークバーのハイブリッド入力 */
export default function StartTimeSection({
  selectedTrack,
  startTime,
  onStartTimeChange,
  spotifyToken,
  connectingSpotify,
  onConnect,
  player,
  seekValue,
  onSeekChange,
  onSeekCommit,
}: StartTimeSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>再生開始位置</h3>

      {/* 現在の設定値 — 常に表示・直接編集可 */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={startTime}
          onChange={(e) => onStartTimeChange(e.target.value)}
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

      <SpotifyPlayerPanel
        selectedTrack={selectedTrack}
        spotifyToken={spotifyToken}
        connectingSpotify={connectingSpotify}
        onConnect={onConnect}
        player={player}
        seekValue={seekValue}
        onSeekChange={onSeekChange}
        onSeekCommit={onSeekCommit}
        onSetStartTime={onStartTimeChange}
      />
    </div>
  );
}
