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
  const playerRef = useRef<any>(null);
  const deviceIdRef = useRef("");
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
      // 前のプレイヤーが残っていれば切断してから新しく作る
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }

      const p = new window.Spotify.Player({
        name: "ryuryu-music MJ writer",
        getOAuthToken: (cb: (t: string) => void) => cb(token!),
        volume: 0.7,
      });

      playerRef.current = p;

      p.addListener("ready", ({ device_id }: { device_id: string }) => {
        deviceIdRef.current = device_id;
        setIsReady(true);
      });

      p.addListener("not_ready", () => {
        setIsReady(false);
        // 接続が切れたら2秒後に再接続を試みる
        setTimeout(() => { p.connect(); }, 2000);
      });

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
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
      if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
      setIsReady(false);
      setIsPaused(true);
      setPosition(0);
      setDuration(0);
    };
  }, [token]);

  useEffect(() => {
    if (!isReady || isPaused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(async () => {
      if (isSeeking.current || !playerRef.current) return;
      const state = await playerRef.current.getCurrentState();
      if (state) setPosition(state.position as number);
    }, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isReady, isPaused]);

  async function playTrack(uri: string) {
    if (!deviceIdRef.current || !token) return;
    setSdkError("");
    const res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceIdRef.current}`,
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
    playerRef.current?.seek(ms);
  }

  function togglePlay() {
    playerRef.current?.togglePlay();
  }

  return { isReady, isPaused, position, duration, sdkError, playTrack, togglePlay, commitSeek };
}
