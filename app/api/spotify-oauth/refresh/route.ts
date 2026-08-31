import { NextRequest, NextResponse } from "next/server";
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE, refreshCookieOptions } from "@/lib/spotify-oauth-cookie";

export const dynamic = "force-dynamic";

/**
 * httpOnly Cookie に保存した refresh_token を使ってアクセストークンを再発行する。
 * Spotify が refresh_token をローテーションした場合は Cookie も更新する。
 * 失効している場合は Cookie を削除して 401 を返す（クライアントは再接続へ誘導）。
 */
export async function GET(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "no_refresh_token" }, { status: 401 });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const out = NextResponse.json({ error: "refresh_failed" }, { status: 401 });
    out.cookies.set(REFRESH_COOKIE, "", refreshCookieOptions(0));
    return out;
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const out = NextResponse.json({ token: data.access_token, expiresIn: data.expires_in });
  if (data.refresh_token) {
    out.cookies.set(REFRESH_COOKIE, data.refresh_token, refreshCookieOptions(REFRESH_COOKIE_MAX_AGE));
  }
  return out;
}
