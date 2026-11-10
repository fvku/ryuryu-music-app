import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { STATE_COOKIE, STATE_COOKIE_MAX_AGE, stateCookieOptions } from "@/lib/spotify-oauth-cookie";
import { guardMember } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await guardMember();
  if (!gate.ok) return gate.response;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://127.0.0.1:3000";
  const redirectUri = `${baseUrl}/api/spotify-oauth/callback`;
  const state = randomBytes(32).toString("base64url");

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set(
    "scope",
    "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state"
  );
  url.searchParams.set("show_dialog", "true");
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url.toString());
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(STATE_COOKIE, state, stateCookieOptions(STATE_COOKIE_MAX_AGE));
  return response;
}
