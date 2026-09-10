import { NextRequest, NextResponse } from "next/server";
import { backfillAlbumUids } from "@/lib/ops/backfill-album-uids";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "backfill-album-uids", body);
  if (!gate.ok) return gate.response;
  const { dryRun = true } = body;

  try {
    const result = await backfillAlbumUids({ apply: !dryRun });
    const scoresResult = result.sheets.find((s) => s.sheet === "scores");
    if (scoresResult && scoresResult.exactHit + scoresResult.lowerHit > 0) {
      invalidateCache(CACHE_KEY.SCORES);
    }
    return NextResponse.json({ ...result, dryRun });
  } catch (e) {
    console.error("backfill-album-uids failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
