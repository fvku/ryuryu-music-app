import { NextRequest, NextResponse } from "next/server";
import { requireMemberEmail } from "@/lib/notifications/session";
import { markNotificationsRead } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

// POST — 既読にする。body.ids が無ければ自分の未読すべて
export async function POST(request: NextRequest) {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;

  const body = await request.json().catch(() => ({})) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string" && !v.startsWith("alert:")) : undefined;
  try {
    await markNotificationsRead(email, ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to mark notifications read:", error);
    return NextResponse.json({ error: "既読にできませんでした" }, { status: 500 });
  }
}
