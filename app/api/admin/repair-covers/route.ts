import { NextRequest, NextResponse } from "next/server";
import { repairCovers } from "@/lib/ops/repair-covers";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";
import { parseSpotifyBatchLimit } from "@/lib/admin-spotify-batch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "repair-covers", body);
  if (!gate.ok) return gate.response;
  const limit = parseSpotifyBatchLimit(body.limit);
  if (limit === null) return NextResponse.json({ error: "最大件数は1〜100の整数で指定してください" }, { status: 400 });

  try {
    const result = await repairCovers({ limit });
    if (result.fixed > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({
      ...result,
      ...(result.total === 0 ? { message: "補完対象なし" } : {}),
    });
  } catch (e) {
    console.error("repair-covers failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
