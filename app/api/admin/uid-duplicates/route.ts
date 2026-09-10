import { NextRequest, NextResponse } from "next/server";
import { checkUidDuplicates } from "@/lib/ops/check-uid-duplicates";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "uid-duplicates", body);
  if (!gate.ok) return gate.response;

  try {
    const duplicates = await checkUidDuplicates();
    return NextResponse.json({ duplicates });
  } catch (e) {
    console.error("uid-duplicates check failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
