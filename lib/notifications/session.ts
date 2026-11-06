import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAllowedMember } from "@/lib/member-access";

/** ログイン中の許可メンバーのメールを返す。違えばそのまま返せるエラー応答 */
export async function requireMemberEmail(): Promise<string | NextResponse> {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  if (!isAllowedMember(email)) return NextResponse.json({ error: "このアカウントでは使えません" }, { status: 403 });
  return email;
}
