"use client";

import { useEffect, useReducer, useRef } from "react";

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

/* -------------------------------------------------------------------------
 * モジュールスコープの共有プレイヤー
 *
 * モーダルを開くたびに Spotify.Player を作り直して connect/disconnect すると、
 * Spotify Connect 上で SDK 端末が入れ替わり、2枚目以降のアルバムで再生すると
 * «Device not found» になる。原因:
 *   - disconnect() が not_ready を発火 → 旧ハンドラが 2秒後に connect() を予約
 *   - モーダルを閉じてもそのタイマーは消えず、殺したはずの端末がゾンビ復活
 *   - 次のモーダルで登録した端末をゾンビが蹴り落とす
 * 対策として、プレイヤーはページ内で1つだけ生成し、モーダルを閉じても切断しない。
 * ----------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedPlayer: any = null;
let sharedDeviceId = "";
let latestToken: string | null = null;
let sdkScriptRequested = false;
let mountCount = 0; // モーダルが1つでも開いている間だけ自動再接続する
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

interface SharedState {
  isReady: boolean;
  isPaused: boolean;
  position: number;
  duration: number;
  sdkError: string;
}

const sharedState: SharedState = {
  isReady: false,
  isPaused: true,
  position: 0,
  duration: 0,
  sdkError: "",
};

const subscribers = new Set<() => void>();

function patch(next: Partial<SharedState>) {
  Object.assign(sharedState, next);
  for (const notify of subscribers) notify();
}

function ensurePlayer() {
  if (sharedPlayer || !latestToken || !window.Spotify) return;

  const p = new window.Spotify.Player({
    name: "ryuryu-music MJ writer",
    getOAuthToken: (cb: (t: string) => void) => {
      if (latestToken) cb(latestToken);
    },
    volume: 0.7,
  });
  sharedPlayer = p;

  p.addListener("ready", ({ device_id }: { device_id: string }) => {
    sharedDeviceId = device_id;
    patch({ isReady: true, sdkError: "" });
  });

  p.addListener("not_ready", () => {
    sharedDeviceId = "";
    patch({ isReady: false });
    // 一時的な切断のみ復帰させる。disconnect() は呼ばないのでゾンビ化しない。
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (sharedPlayer === p && mountCount > 0) p.connect();
    }, 2000);
  });

  p.addListener("player_state_changed", (state: Record<string, unknown> | null) => {
    if (!state) return;
    patch({
      isPaused: state.paused as boolean,
      position: state.position as number,
      duration: (state.duration as number) ?? 0,
    });
  });

  p.addListener("initialization_error", ({ message }: { message: string }) =>
    patch({ sdkError: `初期化エラー: ${message}` })
  );
  p.addListener("authentication_error", ({ message }: { message: string }) =>
    patch({ sdkError: `認証エラー: ${message}` })
  );
  p.addListener("account_error", ({ message }: { message: string }) =>
    patch({ sdkError: `アカウントエラー（Spotify Premium必須）: ${message}` })
  );

  p.connect();
}

function loadSdkAndInit() {
  if (typeof window === "undefined") return;

  if (window.Spotify) {
    ensurePlayer();
    return;
  }

  const prev = window.onSpotifyWebPlaybackSDKReady;
  window.onSpotifyWebPlaybackSDKReady = () => {
    prev?.();
    ensurePlayer();
  };

  if (
    !sdkScriptRequested &&
    !document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')
  ) {
    sdkScriptRequested = true;
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);
  }
}

export function useSpotifyPlayer(token: string | null | undefined): UseSpotifyPlayerReturn {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const isSeeking = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 共有stateの変更を購読
  useEffect(() => {
    const notify = () => forceRender();
    subscribers.add(notify);
    mountCount += 1;
    return () => {
      subscribers.delete(notify);
      mountCount -= 1;
      // 最後のモーダルが閉じたら、予約済みの自動再接続はキャンセル（切断はしない）
      if (mountCount <= 0 && reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
  }, []);

  // 最新トークンを共有スロットへ反映し、必要ならプレイヤーを生成
  useEffect(() => {
    latestToken = token ?? null;
    if (latestToken) loadSdkAndInit();
  }, [token]);

  const { isReady, isPaused, position, duration, sdkError } = sharedState;

  // 再生位置のポーリング（再生中のみ）
  useEffect(() => {
    if (!isReady || isPaused) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(async () => {
      if (isSeeking.current || !sharedPlayer) return;
      const state = await sharedPlayer.getCurrentState();
      if (state) patch({ position: state.position as number });
    }, 500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isReady, isPaused]);

  async function playTrack(uri: string) {
    if (!sharedDeviceId || !latestToken) return;
    patch({ sdkError: "" });

    const attempt = () =>
      fetch(`https://api.spotify.com/v1/me/player/play?device_id=${sharedDeviceId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${latestToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [uri] }),
      });

    let res = await attempt();

    // ready 直後は SDK デバイスが Spotify バックエンドに載るまで数百 ms かかることがあり、
    // その間は 404 (Device not found) が返る。少し待って一度だけ再試行する。
    if (res.status === 404) {
      await new Promise((r) => setTimeout(r, 500));
      res = await attempt();
    }

    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      patch({
        sdkError: `再生エラー: ${(body as { error?: { message?: string } })?.error?.message ?? res.status}`,
      });
    }
  }

  function commitSeek(ms: number) {
    isSeeking.current = false;
    patch({ position: ms });
    sharedPlayer?.seek(ms);
  }

  function togglePlay() {
    sharedPlayer?.togglePlay();
  }

  return { isReady, isPaused, position, duration, sdkError, playTrack, togglePlay, commitSeek };
}
