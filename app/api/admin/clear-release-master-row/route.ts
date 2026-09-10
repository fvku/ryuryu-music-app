import { NextRequest, NextResponse } from "next/server";
import { clearReleaseMasterRow } from "@/lib/release-master";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "clear-release-master-row", body);
  if (!gate.ok) return gate.response;
  const { rowNum } = body;
  if (!rowNum) {
    return NextResponse.json({ error: "rowNum は必須です" }, { status: 400 });
  }

  try {
    await clearReleaseMasterRow(rowNum);
    invalidateCache(CACHE_KEY.RELEASE_MASTER);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("clear-release-master-row failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
