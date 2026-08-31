import { NextRequest, NextResponse } from "next/server";
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE, refreshCookieOptions } from "@/lib/spotify-oauth-cookie";

export const dynamic = "force-dynamic";

function htmlResponse(script: string, refreshToken?: string) {
  const res = new NextResponse(
    `<!DOCTYPE html><html><body><script>${script}<\/script></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
  if (refreshToken) {
    res.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions(REFRESH_COOKIE_MAX_AGE));
  }
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return htmlResponse(
      `window.opener?.postMessage({type:"SPOTIFY_AUTH_ERROR",error:${JSON.stringify(error ?? "cancelled")}},window.location.origin);window.close();`
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/spotify-oauth/callback`;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    return htmlResponse(
      `window.opener?.postMessage({type:"SPOTIFY_AUTH_ERROR",error:"token_exchange_failed"},window.location.origin);window.close();`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  return htmlResponse(
    `window.opener?.postMessage({type:"SPOTIFY_AUTH_SUCCESS",token:${JSON.stringify(data.access_token)},expiresIn:${data.expires_in}},window.location.origin);window.close();`,
    data.refresh_token
  );
}
