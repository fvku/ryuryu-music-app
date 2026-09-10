import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import { isAllowedMember } from "@/lib/member-access";

export const dynamic = "force-dynamic";

/** 管理画面が「いま誰として開かれているか」を知るための読み取り専用ルート */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const googleVerified = session?.loginProvider === "google" && session?.googleVerifiedEmail === email;

  return NextResponse.json({
    email,
    isMember: !!email && isAllowedMember(email),
    googleVerified,
    isAdmin: !!email && isAllowedMember(email) && googleVerified && isAdminEmail(email),
  });
}
