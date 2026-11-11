import { NextResponse } from "next/server";
import { guardMember } from "@/lib/member-auth";
import { readCronStatus } from "@/lib/cron-status-store";

export const dynamic = "force-dynamic";

export async function GET() {
  // 管理操作と同じGoogle検証済みメンバーに限定。閲覧でadmin_logsを書かない。
  const gate = await guardMember();
  if (!gate.ok) return gate.response;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return NextResponse.json(await readCronStatus(), { headers });
  } catch {
    // Googleのエラー本文・資格情報等を画面やAI共有文へ流さない。
    return NextResponse.json({ error: "定期実行の記録を取得できませんでした。Koheiに連絡してください。" }, { status: 503, headers });
  }
}
