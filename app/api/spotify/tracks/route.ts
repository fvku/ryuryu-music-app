import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const spotifyUrl = searchParams.get("spotifyUrl");
  if (!spotifyUrl) {
    return NextResponse.json({ error: "spotifyUrl is required" }, { status: 400 });
  }

  // Extract album ID from Spotify URL: https://open.spotify.com/album/{id}
  const match = spotifyUrl.match(/album\/([a-zA-Z0-9]+)/);
  if (!match) {
    return NextResponse.json({ error: "Invalid Spotify URL" }, { status: 400 });
  }
  const albumId = match[1];

  try {
    const accessToken = await getAccessToken();
    const res = await fetch(
      `https://api.spotify.com/v1/albums/${albumId}/tracks?market=JP&limit=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);

    const data = await res.json();
    const tracks = (data.items as { track_number: number; name: string; duration_ms: number }[]).map((t) => ({
      trackNumber: t.track_number,
      name: t.name,
      durationMs: t.duration_ms,
    }));

    return NextResponse.json(tracks);
  } catch (e) {
    console.error("Failed to fetch Spotify tracks:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
