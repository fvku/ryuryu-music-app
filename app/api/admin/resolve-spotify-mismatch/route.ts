import { NextRequest, NextResponse } from "next/server";
import { writeManualSpotifyMatch } from "@/lib/ops/refetch-spotify";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "resolve-spotify-mismatch", body);
  if (!gate.ok) return gate.response;
  const { rowNum, spotifyUrl, coverUrl } = body;
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
