import { NextRequest, NextResponse } from "next/server";
import { searchAlbums } from "@/lib/spotify";
import { writeSpotifyDataToSheet } from "@/lib/release-master";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { albums } = await request.json() as {
      albums: { no: string; title: string; artist: string }[];
    };

    const results = await Promise.all(
      albums.map(async ({ no, title, artist }) => {
        try {
          const found = await searchAlbums(`${artist} ${title}`);
          return {
            no,
            coverUrl: found[0]?.coverUrl ?? "",
            spotifyUrl: found[0]?.spotifyUrl ?? "",
          };
        } catch {
          return { no, coverUrl: "", spotifyUrl: "" };
        }
      })
    );

    const data: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
    results.forEach((r) => { data[r.no] = { coverUrl: r.coverUrl, spotifyUrl: r.spotifyUrl }; });

    // Write back to Release Master sheet (best-effort, don't block response)
    const toWrite = results.filter((r) => r.spotifyUrl || r.coverUrl);
    if (toWrite.length > 0) {
      writeSpotifyDataToSheet(toWrite).catch((e) => {
        console.error("Failed to write Spotify data to sheet:", e);
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch covers:", error);
    return NextResponse.json({}, { status: 500 });
  }
}
