import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/spotify-oauth/callback`;

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "streaming user-read-email user-read-private");
  url.searchParams.set("show_dialog", "true");

  return NextResponse.redirect(url.toString());
}
