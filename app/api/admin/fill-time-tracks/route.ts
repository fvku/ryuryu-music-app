import { NextRequest, NextResponse } from "next/server";
import { fillTimeTracks } from "@/lib/ops/fill-time-tracks";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { adminPassword, dryRun = true, limit = 15 } = await req.json();
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await fillTimeTracks({ apply: !dryRun, limit: Math.min(limit, 20) });
    if (result.written > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({
      ok: result.ok,
      skipNotFound: result.skipNotFound,
      skipDateMismatch: result.skipDateMismatch,
      total: result.total,
      details: result.details,
      dryRun,
    });
  } catch (e) {
    console.error("fill-time-tracks failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
