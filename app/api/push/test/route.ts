import { NextResponse } from "next/server";
import { requireMemberEmail } from "@/lib/notifications/session";
import { notifyMember } from "@/lib/notifications/send";
import { getDisplayName } from "@/lib/members";

export const dynamic = "force-dynamic";

// POST — 自分にテスト通知を送る（登録した全端末とベル一覧）
export async function POST() {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;
  try {
    const result = await notifyMember(email, {
      kind: "test",
      title: "テスト通知",
      body: `${getDisplayName(email)}さん、通知は届いています。`,
      url: "/settings",
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to send test notification:", error);
    return NextResponse.json({ error: "テスト通知を送れませんでした" }, { status: 500 });
  }
}
