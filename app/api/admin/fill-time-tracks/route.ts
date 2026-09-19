import { NextRequest, NextResponse } from "next/server";
import { fillTimeTracks } from "@/lib/ops/fill-time-tracks";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";
import { parseSpotifyBatchLimit } from "@/lib/admin-spotify-batch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "fill-time-tracks", body);
  if (!gate.ok) return gate.response;
  const { dryRun = true } = body;
  const limit = parseSpotifyBatchLimit(body.limit ?? 15);
  if (limit === null) return NextResponse.json({ error: "最大件数は1〜100の整数で指定してください" }, { status: 400 });

  try {
    const result = await fillTimeTracks({ apply: !dryRun, limit });
    if (result.written > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({
      ok: result.ok,
      skipNotFound: result.skipNotFound,
      skipNoUrl: result.skipNoUrl,
      total: result.total,
      details: result.details,
      dryRun,
    });
  } catch (e) {
    console.error("fill-time-tracks failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
