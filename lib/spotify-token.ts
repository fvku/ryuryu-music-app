const TOKEN_KEY = "ryuryu_spotify_token";
const EXPIRY_KEY = "ryuryu_spotify_token_expiry";

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
