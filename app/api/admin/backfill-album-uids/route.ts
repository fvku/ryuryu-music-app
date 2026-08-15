import { NextRequest, NextResponse } from "next/server";
import { backfillAlbumUids } from "@/lib/ops/backfill-album-uids";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { adminPassword, dryRun = true } = await req.json();
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
