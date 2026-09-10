import { NextRequest, NextResponse } from "next/server";
import { refetchSpotifyUrls } from "@/lib/ops/refetch-spotify";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type { RefetchMismatch } from "@/lib/ops/refetch-spotify";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "refetch-spotify", body);
  if (!gate.ok) return gate.response;
  const { limit = 30 } = body;

  try {
    const result = await refetchSpotifyUrls({ apply: true, limit });
    if (result.written > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({
      ...result,
      ...(result.total === 0 ? { message: "対象行なし（Spotify URLが空の行はありません）" } : {}),
    });
  } catch (e) {
    console.error("refetch-spotify failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
