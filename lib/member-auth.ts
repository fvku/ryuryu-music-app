import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { memberAccess } from "@/lib/member-access";

type MemberGate = { ok: true; email: string } | { ok: false; response: NextResponse };

/** 通常APIの認可。書き込みは、許可メンバーの検証済みGoogleセッション＋同一オリジンに限る。 */
export async function guardMember(request?: Request): Promise<MemberGate> {
  const access = memberAccess(await auth());
  if (!access.ok) {
    return { ok: false, response: NextResponse.json({ error: access.error }, {
      status: access.status, headers: { "Cache-Control": "private, no-store" },
    }) };
  }
  if (request && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (origin !== new URL(request.url).origin || (site && site !== "same-origin")) {
      return { ok: false, response: NextResponse.json({ error: "同じサイトから操作してください" }, { status: 403 }) };
    }
  }
  return access;
}
