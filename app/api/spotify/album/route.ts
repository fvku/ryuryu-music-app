import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function hasJapaneseChars(text: string): boolean {
  return /[぀-ヿ一-鿿･-ﾟ]/.test(text);
}

const JP_GENRE_RE = /j[-.]?(pop|rock|indie|rap|metal|dance|r&b|soul|folk|hip.?hop)|^japanese\b|city.?pop|shibuya|visual.?kei/i;

function detectWaboku(artistName: string, albumName: string, genres: string[]): "邦楽" | "洋楽" {
  if (hasJapaneseChars(artistName) || hasJapaneseChars(albumName)) return "邦楽";
  if (genres.some((g) => JP_GENRE_RE.test(g))) return "邦楽";
  return "洋楽";
}

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const albumId = searchParams.get("id");
  if (!albumId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    // キャッシュを使わず毎回フレッシュなトークンを取得
    const accessToken = await fetchFreshToken();
    const response = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json({ error: "Album not found", status: response.status, body }, { status: 404 });
    }

    const data = await response.json();

    // アーティストジャンルを取得（邦楽/洋楽判定に使用）
    const primaryArtistId: string | undefined = data.artists?.[0]?.id;
    let artistGenres: string[] = [];
    if (primaryArtistId) {
      const artistRes = await fetch(`https://api.spotify.com/v1/artists/${primaryArtistId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (artistRes.ok) {
        const artistData = await artistRes.json();
        artistGenres = artistData.genres ?? [];
      }
    }

    const artistName = (data.artists ?? []).map((a: { name: string }) => a.name).join(", ");
    const waboku = detectWaboku(artistName, data.name ?? "", artistGenres);

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
      artist: artistName,
      albumType: (data.album_type ?? "album") as string,
      waboku,
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
