import { NextRequest, NextResponse } from "next/server";
import { repairSpotifyUrls } from "@/lib/ops/repair-spotify";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { adminPassword } = await req.json();
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await repairSpotifyUrls();
    if (result.fixed > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({
      ...result,
      ...(result.total === 0 ? { message: "修復対象なし" } : {}),
    });
  } catch (e) {
    console.error("repair-spotify failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
