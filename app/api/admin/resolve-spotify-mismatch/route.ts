import { NextRequest, NextResponse } from "next/server";
import { writeManualSpotifyMatch } from "@/lib/ops/refetch-spotify";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { adminPassword, rowNum, spotifyUrl, coverUrl } = await req.json();
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!rowNum || !spotifyUrl) {
    return NextResponse.json({ error: "rowNum, spotifyUrl は必須です" }, { status: 400 });
  }

  try {
    await writeManualSpotifyMatch(rowNum, spotifyUrl, coverUrl ?? "");
    invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("resolve-spotify-mismatch failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
