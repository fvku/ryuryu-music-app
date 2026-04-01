import { NextRequest, NextResponse } from "next/server";
import { searchAlbums } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  if (!query || query.trim().length === 0) {
    return NextResponse.json(
      { error: "検索クエリを入力してください" },
      { status: 400 }
    );
  }

  try {
    const albums = await searchAlbums(query.trim());
    return NextResponse.json(albums);
  } catch (error) {
    console.error("Spotify search error:", error);
    return NextResponse.json(
      { error: "アルバムの検索に失敗しました。しばらくしてからもう一度お試しください。" },
      { status: 500 }
    );
  }
}
