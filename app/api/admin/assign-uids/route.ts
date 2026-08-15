import { NextRequest, NextResponse } from "next/server";
import { assignUids } from "@/lib/ops/assign-uids";
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
    const result = await assignUids({ apply: !dryRun });
    if (result.assigned > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({ ...result, dryRun });
  } catch (e) {
    console.error("assign-uids failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
