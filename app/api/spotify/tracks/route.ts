import { guardMember } from "@/lib/member-auth";
import { NextRequest, NextResponse } from "next/server";
import { bearerPageFetcher, collectAllTrackItems, toAppTrack } from "@/lib/spotify-album-tracks";

export const dynamic = "force-dynamic";

async function fetchFreshToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Spotify credentials not set");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Token fetch failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

export async function GET(req: NextRequest) {
  const gate = await guardMember();
  if (!gate.ok) return gate.response;
  const { searchParams } = new URL(req.url);
  const spotifyUrl = searchParams.get("spotifyUrl");
  if (!spotifyUrl) {
    return NextResponse.json({ error: "spotifyUrl is required" }, { status: 400 });
  }

  const match = spotifyUrl.match(/album\/([a-zA-Z0-9]+)/);
  if (!match) {
    return NextResponse.json({ error: "Invalid Spotify URL" }, { status: 400 });
  }
  const albumId = match[1];

  try {
    const accessToken = await fetchFreshToken();
    const fetchPage = bearerPageFetcher(accessToken);
    const first = await fetchPage(`https://api.spotify.com/v1/albums/${albumId}/tracks?market=JP&limit=50`);
    const items = await collectAllTrackItems(first, fetchPage);
    const tracks = items.map(toAppTrack);
    return NextResponse.json(tracks);
  } catch (e) {
    console.error("Failed to fetch Spotify tracks:", e);
    return NextResponse.json({ error: "トラックの取得に失敗しました" }, { status: 500 });
  }
}
