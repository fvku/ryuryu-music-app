"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Spotify: any;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

export interface UseSpotifyPlayerReturn {
  isReady: boolean;
  isPaused: boolean;
  position: number;
  duration: number;
  sdkError: string;
  playTrack: (uri: string) => Promise<void>;
  togglePlay: () => void;
  commitSeek: (ms: number) => void;
}

export function useSpotifyPlayer(token: string | null | undefined): UseSpotifyPlayerReturn {
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

  useEffect(() => {
    if (!token) return;

    function initPlayer() {
      const p = new window.Spotify.Player({
        name: "ryuryu-music MJ writer",
        getOAuthToken: (cb: (t: string) => void) => cb(token!),
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
      p.addListener("initialization_error", ({ message }: { message: string }) =>
        setSdkError(`初期化エラー: ${message}`)
      );
      p.addListener("authentication_error", ({ message }: { message: string }) =>
        setSdkError(`認証エラー: ${message}`)
      );
      p.addListener("account_error", ({ message }: { message: string }) =>
        setSdkError(`アカウントエラー（Spotify Premium必須）: ${message}`)
      );

      p.connect();
    }

    if (window.Spotify) {
      initPlayer();
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = initPlayer;

    if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [token]);

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

  async function playTrack(uri: string) {
    if (!deviceId || !token) return;
    setSdkError("");
    const res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [uri] }),
      }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      setSdkError(
        `再生エラー: ${(body as { error?: { message?: string } })?.error?.message ?? res.status}`
      );
    }
  }

  function commitSeek(ms: number) {
    isSeeking.current = false;
    setPosition(ms);
    player?.seek(ms);
  }

  function togglePlay() {
    player?.togglePlay();
  }

  return { isReady, isPaused, position, duration, sdkError, playTrack, togglePlay, commitSeek };
}
