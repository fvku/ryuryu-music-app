"use client";

import { SpotifyTrack } from "@/hooks/useMjTracks";
import { formatDuration } from "./utils";

interface TrackSelectorProps {
  effectiveSpotifyUrl?: string;
  tracks: SpotifyTrack[];
  loadingTracks: boolean;
  trackError: string | null;
  selectedTrack: SpotifyTrack | null;
  onSelectTrack: (track: SpotifyTrack | null) => void;
  isPlayerReady: boolean;
  onPlayTrack: (uri: string) => void;
}

/** おすすめトラック一覧（選択中チップ・ローディング/エラー/リスト） */
export default function TrackSelector({
  effectiveSpotifyUrl,
  tracks,
  loadingTracks,
  trackError,
  selectedTrack,
  onSelectTrack,
  isPlayerReady,
  onPlayTrack,
}: TrackSelectorProps) {
  return (
    <div>
      <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>
        おすすめトラック
      </h3>
      {selectedTrack && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)" }}>
          <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>#{selectedTrack.trackNumber}</span>
          <span className="text-sm font-medium flex-1 truncate" style={{ color: "white" }}>{selectedTrack.name}</span>
          <button type="button" onClick={() => onSelectTrack(null)} className="text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--text-secondary)" }}>外す</button>
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
                    onSelectTrack(null);
                  } else {
                    onSelectTrack(track);
                    if (isPlayerReady && track.uri) onPlayTrack(track.uri);
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
  );
}
