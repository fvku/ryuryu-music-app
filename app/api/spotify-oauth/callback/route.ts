import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function htmlResponse(script: string) {
  return new NextResponse(
    `<!DOCTYPE html><html><body><script>${script}<\/script></body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return htmlResponse(
      `window.opener?.postMessage({type:"SPOTIFY_AUTH_ERROR",error:${JSON.stringify(error ?? "cancelled")}},"*");window.close();`
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
      `window.opener?.postMessage({type:"SPOTIFY_AUTH_ERROR",error:"token_exchange_failed"},"*");window.close();`
    );
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  return htmlResponse(
    `window.opener?.postMessage({type:"SPOTIFY_AUTH_SUCCESS",token:${JSON.stringify(data.access_token)},expiresIn:${data.expires_in}},"*");window.close();`
  );
}
