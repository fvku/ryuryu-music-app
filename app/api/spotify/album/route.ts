import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const albumId = searchParams.get("id");
  if (!albumId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const accessToken = await getAccessToken();
    const response = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const data = await response.json();

    const totalDurationMs: number = (data.tracks?.items ?? []).reduce(
      (sum: number, track: { duration_ms: number }) => sum + (track.duration_ms ?? 0),
      0
    );

    const tracks: { name: string; durationMs: number }[] = (data.tracks?.items ?? []).map(
      (t: { name: string; duration_ms: number }) => ({
        name: t.name,
        durationMs: t.duration_ms,
      })
    );

    return NextResponse.json({
      id: data.id,
      title: data.name,
      artist: (data.artists ?? []).map((a: { name: string }) => a.name).join(", "),
      releaseDate: data.release_date ?? "",
      trackCount: data.total_tracks ?? tracks.length,
      totalDurationMs,
      coverUrl: data.images?.[0]?.url ?? "",
      spotifyUrl: data.external_urls?.spotify ?? `https://open.spotify.com/album/${albumId}`,
      tracks,
    });
  } catch (error) {
    console.error("Spotify album fetch failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
