import { NextRequest, NextResponse } from "next/server";
import { fillTimeTracks } from "@/lib/ops/fill-time-tracks";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "fill-time-tracks", body);
  if (!gate.ok) return gate.response;
  const { dryRun = true, limit = 15 } = body;

  try {
    const result = await fillTimeTracks({ apply: !dryRun, limit: Math.min(limit, 20) });
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
