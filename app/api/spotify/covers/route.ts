import { after, NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchAlbums } from "@/lib/spotify";
import { artistMatch, titleMatch } from "@/lib/spotify-match";
import { writeSpotifyDataToSheet } from "@/lib/release-master";

export const dynamic = "force-dynamic";

interface CoverRequestAlbum {
  no: string;
  title: string;
  artist: string;
  /** シートに既に入っている値。あればそのまま返し、検索結果で置き換えない（Bandcamp等のURLを守る） */
  spotifyUrl?: string;
  coverUrl?: string;
}

/**
 * Spotify URL またはカバー画像が空のアルバムを検索で補う。
 * 検索結果はアルバム名・アーティスト名が一致したものだけ採用する
 * （1件目をそのまま使うと別アーティストの作品が紐付くため）。
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  try {
    const { albums } = await request.json() as { albums: CoverRequestAlbum[] };

    // 公式APIを並列で叩くと429になるため直列で引く
    const results: (CoverRequestAlbum & { spotifyUrl: string; coverUrl: string })[] = [];
    for (const album of albums) {
      const { title, artist } = album;
      let found: { spotifyUrl: string; coverUrl: string } | undefined;
      try {
        const candidates = await searchAlbums(`${artist} ${title}`);
        found = candidates.find((c) => titleMatch(title, c.name) && artistMatch(artist, c.artist));
      } catch {
        found = undefined;
      }
      results.push({
        ...album,
        spotifyUrl: album.spotifyUrl || found?.spotifyUrl || "",
        coverUrl: album.coverUrl || found?.coverUrl || "",
      });
    }

    const data: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
    results.forEach((r) => { data[r.no] = { coverUrl: r.coverUrl, spotifyUrl: r.spotifyUrl }; });

    // シートへの書き戻しはレスポンス後に行う（空欄のセルだけ埋める）
    const toWrite = results.filter((r) => r.spotifyUrl || r.coverUrl);
    if (toWrite.length > 0) {
      after(() =>
        writeSpotifyDataToSheet(toWrite).catch((e) => {
          console.error("Failed to write Spotify data to sheet:", e);
        })
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to fetch covers:", error);
    return NextResponse.json({}, { status: 500 });
  }
}
