import { NextRequest, NextResponse } from "next/server";
import { checkUidDuplicates } from "@/lib/ops/check-uid-duplicates";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { adminPassword } = await req.json();
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const duplicates = await checkUidDuplicates();
    return NextResponse.json({ duplicates });
  } catch (e) {
    console.error("uid-duplicates check failed:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
