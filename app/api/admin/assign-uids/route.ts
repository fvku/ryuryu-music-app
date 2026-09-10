import { NextRequest, NextResponse } from "next/server";
import { assignUids } from "@/lib/ops/assign-uids";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "assign-uids", body);
  if (!gate.ok) return gate.response;
  const { dryRun = true } = body;

  try {
    const result = await assignUids({ apply: !dryRun });
    if (result.assigned > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({ ...result, dryRun });
  } catch (e) {
    console.error("assign-uids failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
