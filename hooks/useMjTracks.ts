"use client";

import { useEffect, useState } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";

export interface SpotifyTrack {
  trackNumber: number;
  name: string;
  durationMs: number;
  uri: string;
}

/**
 * Spotifyトラック一覧の取得と、アルバムの既存M/J設定（トラック番号/名）に基づく初期選択トラックの解決。
 */
export function useMjTracks(effectiveSpotifyUrl: string | undefined, album: ReleaseMasterAlbum) {
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrack | null>(null);

  useEffect(() => {
    if (!effectiveSpotifyUrl) return;
    // フェッチ開始と同時にローディング表示へ切り替えるための意図的な同期setState
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingTracks(true);
    setTrackError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
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

  return { tracks, loadingTracks, trackError, selectedTrack, setSelectedTrack };
}
