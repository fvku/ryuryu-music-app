// v2: scope に user-modify-playback-state / user-read-playback-state を追加したため、
// 旧キーに入っているスコープ不足のトークンを無効化する目的でキー名を変更している。
const TOKEN_KEY = "ryuryu_spotify_token_v2";
const EXPIRY_KEY = "ryuryu_spotify_token_v2_expiry";

// 旧バージョン（スコープ不足）のトークンが残っていれば掃除する
if (typeof window !== "undefined") {
  localStorage.removeItem("ryuryu_spotify_token");
  localStorage.removeItem("ryuryu_spotify_token_expiry");
}

export function getSpotifyToken(): string | null {
  if (typeof window === "undefined") return null;
  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (expiry && Date.now() > parseInt(expiry)) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    return null;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function saveSpotifyToken(token: string, expiresIn: number) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXPIRY_KEY, String(Date.now() + expiresIn * 1000 - 60_000));
}

export function clearSpotifyToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

/**
 * httpOnly Cookie の refresh_token を使ってアクセストークンを再発行する。
 * 成功時は localStorage を更新して新トークンを返す。
 * refresh_token が無い/失効している場合は localStorage を掃除して null を返す
 * （呼び出し側は「再接続」導線へ誘導する）。
 */
export async function refreshSpotifyToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/spotify-oauth/refresh", { cache: "no-store" });
    if (!res.ok) {
      clearSpotifyToken();
      return null;
    }
    const data = (await res.json()) as { token: string; expiresIn: number };
    saveSpotifyToken(data.token, data.expiresIn);
    return data.token;
  } catch {
    // ネットワーク断など一時的な失敗。localStorage は消さず現状維持。
    return null;
  }
}

export function openSpotifyAuthPopup(
  onSuccess: (token: string, expiresIn: number) => void,
  onError?: (error: string) => void
) {
  let popup: Window | null = null;
  let finished = false;
  const timers: {
    poll?: ReturnType<typeof setInterval>;
    deadline?: ReturnType<typeof setTimeout>;
    close?: ReturnType<typeof setTimeout>;
  } = {};

  function cleanup() {
    window.removeEventListener("message", handleMessage);
    clearInterval(timers.poll);
    clearTimeout(timers.deadline);
    clearTimeout(timers.close);
  }

  function fail(error: string) {
    if (finished) return;
    finished = true;
    cleanup();
    onError?.(error);
  }

  function handleMessage(e: MessageEvent) {
    // オリジンに加えて、今回開いたポップアップからの結果だけを受け取る。
    if (finished || !popup || e.origin !== window.location.origin || e.source !== popup) return;
    if (e.data?.type === "SPOTIFY_AUTH_SUCCESS") {
      if (typeof e.data.token !== "string" || !e.data.token
        || typeof e.data.expiresIn !== "number" || !Number.isFinite(e.data.expiresIn) || e.data.expiresIn <= 0) {
        fail("invalid_response");
        return;
      }
      finished = true;
      cleanup();
      try {
        onSuccess(e.data.token, e.data.expiresIn);
      } catch {
        // localStorageが使えない場合なども「接続中」のまま残さない。
        onError?.("storage_unavailable");
      }
    } else if (e.data?.type === "SPOTIFY_AUTH_ERROR") {
      fail(typeof e.data.error === "string" ? e.data.error : "invalid_response");
    }
  }

  // 先に購読して、素早いコールバックでも結果を取りこぼさない。
  window.addEventListener("message", handleMessage);
  try {
    popup = window.open("/api/spotify-oauth", "spotify-auth", "width=500,height=700,left=200,top=100");
  } catch {
    fail("popup_blocked");
    return;
  }
  if (!popup) {
    fail("popup_blocked");
    return;
  }

  timers.poll = setInterval(() => {
    try {
      if (popup?.closed && !timers.close) {
        // close直前に送られたpostMessageが先に届く余地を残す。
        timers.close = setTimeout(() => fail("cancelled"), 250);
      }
    } catch {
      // ブラウザのウィンドウ分離で参照できない場合も期限までは結果を待つ。
    }
  }, 500);
  timers.deadline = setTimeout(() => fail("timeout"), 5 * 60 * 1000);
}

export function spotifyAuthErrorMessage(error: string): string {
  if (error === "popup_blocked") return "ポップアップを許可して、もう一度接続してください";
  if (error === "cancelled") return "接続が完了する前に画面が閉じられました。もう一度接続してください";
  if (error === "timeout") return "接続がタイムアウトしました。画面を再読み込みして、もう一度接続してください";
  if (error === "state_mismatch") return "接続の確認に失敗しました。同じURLのアプリを開き直して、もう一度接続してください";
  if (error === "storage_unavailable") return "ブラウザに接続情報を保存できませんでした。ブラウザの設定を確認してください";
  return "Spotifyへの接続に失敗しました。もう一度お試しください";
}
