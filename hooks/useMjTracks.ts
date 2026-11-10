"use client";

import { useEffect, useState } from "react";

export interface SpotifyTrack {
  trackNumber: number;
  name: string;
  durationMs: number;
  uri: string;
  discNumber?: number;
}

/**
 * Spotifyトラック一覧の取得と、保存済みのおすすめ曲（トラック番号/名）に当たる曲の解決。
 *
 * 保存済みの曲（initialTrack）と利用者の選択は分けて扱う。曲一覧の読み込み中・失敗時は
 * initialTrack が null のままになるが、それは「選択を外した」ではない。
 * 呼び出し側は、利用者が実際に選び直したときだけ曲を保存し直すこと。
 */
export function useMjTracks(effectiveSpotifyUrl: string | undefined, savedTrackNo: string, savedTrackName: string) {
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveSpotifyUrl) return;
    let cancelled = false;
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
        if (!cancelled) setTracks(data);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setTrackError(e.message || "トラックを取得できませんでした");
        setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTracks(false);
      });
    return () => { cancelled = true; };
  }, [effectiveSpotifyUrl]);

  const initialTrack = resolveSavedTrack(tracks, savedTrackNo, savedTrackName);

  return { tracks, loadingTracks, trackError, initialTrack };
}

/** 曲名一致を優先し、なければ番号で探す（曲順が変わった・リマスター版などで番号がずれる場合に備える） */
export function resolveSavedTrack(tracks: SpotifyTrack[], savedTrackNo: string, savedTrackName: string): SpotifyTrack | null {
  const name = savedTrackName.trim();
  const no = parseInt(savedTrackNo.trim(), 10);
  const byName = name ? tracks.find((t) => t.name === name) : undefined;
  const byNo = !isNaN(no) ? tracks.find((t) => t.trackNumber === no) : undefined;
  return byName ?? byNo ?? null;
}
