import { NextRequest, NextResponse } from "next/server";
import { syncScoresToRm } from "@/lib/ops/sync-scores-to-rm";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "sync-scores-to-rm", body);
  if (!gate.ok) return gate.response;
  const { force = false } = body;

  try {
    const result = await syncScoresToRm({ force });
    if (result.written > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({ written: result.written, notFound: result.notFound, skipped: result.skipped });
  } catch (e) {
    console.error("sync-scores-to-rm failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
