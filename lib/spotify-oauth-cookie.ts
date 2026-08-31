// Spotify の refresh_token は失効するまで長期間有効なため、
// httpOnly Cookie に隔離し /api/spotify-oauth/* からのみ参照する。

export const REFRESH_COOKIE = "ryuryu_spotify_refresh";
export const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90日

export function refreshCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/spotify-oauth",
    maxAge,
  };
}
