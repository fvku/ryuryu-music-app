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
  const popup = window.open(
    "/api/spotify-oauth",
    "spotify-auth",
    "width=500,height=700,left=200,top=100"
  );

  function handleMessage(e: MessageEvent) {
    // トークンを含むメッセージなので、必ず自オリジンからのものだけ受け取る
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === "SPOTIFY_AUTH_SUCCESS") {
      window.removeEventListener("message", handleMessage);
      onSuccess(e.data.token as string, e.data.expiresIn as number);
    } else if (e.data?.type === "SPOTIFY_AUTH_ERROR") {
      window.removeEventListener("message", handleMessage);
      onError?.(e.data.error as string);
    }
  }

  window.addEventListener("message", handleMessage);

  const timer = setInterval(() => {
    if (popup?.closed) {
      clearInterval(timer);
      window.removeEventListener("message", handleMessage);
    }
  }, 500);
}
