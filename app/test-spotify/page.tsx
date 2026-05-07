"use client";

import { useSession, signIn } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Spotify: any;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

function toSpotifyUri(input: string): string {
  // https://open.spotify.com/track/ID or /intl-xx/track/ID
  const urlMatch = input.match(/open\.spotify\.com(?:\/intl-[a-z]+)?\/track\/([A-Za-z0-9]+)/);
  if (urlMatch) return `spotify:track:${urlMatch[1]}`;
  return input.trim();
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function TestSpotifyPage() {
  const { data: session } = useSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [player, setPlayer] = useState<any>(null);
  const [deviceId, setDeviceId] = useState<string>("");
  const [isReady, setIsReady] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [capturedTime, setCapturedTime] = useState<string>("");
  const [trackUri, setTrackUri] = useState("");
  const [error, setError] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const spotifyToken = (session as Record<string, unknown> | null)?.spotifyAccessToken as string | undefined;

  useEffect(() => {
    if (!spotifyToken) return;

    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: "ryuryu-music test player",
        getOAuthToken: (cb: (token: string) => void) => cb(spotifyToken),
        volume: 0.5,
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
        setPosition(state.position as number);
        setDuration((state.duration as number) ?? 0);
      });

      p.addListener("initialization_error", ({ message }: { message: string }) =>
        setError(`初期化エラー: ${message}`)
      );
      p.addListener("authentication_error", ({ message }: { message: string }) =>
        setError(`認証エラー: ${message}`)
      );
      p.addListener("account_error", ({ message }: { message: string }) =>
        setError(`アカウントエラー（Premium必須）: ${message}`)
      );

      p.connect();
    };

    return () => {
      if (document.body.contains(script)) document.body.removeChild(script);
    };
  }, [spotifyToken]);

  // 再生中は1秒ごとに位置を更新
  useEffect(() => {
    if (!player || isPaused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(async () => {
      const state = await player.getCurrentState();
      if (state) setPosition(state.position as number);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [player, isPaused]);

  async function handlePlay() {
    if (!deviceId || !spotifyToken) return;
    setError("");
    const uri = toSpotifyUri(trackUri);
    const res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${spotifyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [uri] }),
      }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      setError(`再生エラー: ${body?.error?.message ?? res.status}`);
    }
  }

  function capturePosition() {
    setCapturedTime(formatTime(position));
  }

  if (!session) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold mb-4">Spotify Player Test</h1>
        <button
          onClick={() => signIn("google")}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          Googleでログイン
        </button>
      </div>
    );
  }

  if (!spotifyToken) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-xl font-bold mb-4">Spotify Player Test</h1>
        <p className="text-sm text-gray-600 mb-4">
          Spotifyにログインするとセッションが切り替わります。テスト後は再度Googleでログインしてください。
        </p>
        <button
          onClick={() => signIn("spotify")}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
        >
          Spotifyでログイン
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-lg space-y-6">
      <h1 className="text-xl font-bold">Spotify Player Test</h1>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {!isReady && !error && (
        <p className="text-gray-500 text-sm">プレイヤー初期化中...</p>
      )}

      {isReady && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">Track URI</label>
            <input
              value={trackUri}
              onChange={(e) => setTrackUri(e.target.value)}
              className="border px-2 py-1 w-full rounded text-sm"
              placeholder="SpotifyのURLまたはURI（spotify:track:...）を貼り付け"
            />
          </div>

          <button
            onClick={handlePlay}
            className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm"
          >
            このトラックを再生
          </button>

          <div className="border rounded p-4 space-y-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => player?.togglePlay()}
                className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800"
              >
                {isPaused ? "▶ 再生" : "⏸ 一時停止"}
              </button>
              <span className="font-mono text-2xl">
                {formatTime(position)}
                <span className="text-gray-400 text-lg"> / {formatTime(duration)}</span>
              </span>
            </div>

            <button
              onClick={capturePosition}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              この位置をStart Timeとしてセット
            </button>

            {capturedTime && (
              <div className="bg-green-100 border border-green-400 text-green-800 px-4 py-2 rounded text-center font-mono text-lg">
                Start Time: {capturedTime}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
