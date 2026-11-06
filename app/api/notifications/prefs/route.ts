import { NextRequest, NextResponse } from "next/server";
import { requireMemberEmail } from "@/lib/notifications/session";
import { readSavedPrefs, writePrefs } from "@/lib/notifications/store";
import { getNotificationKind, resolvePrefs, type KindPref } from "@/lib/notifications/kinds";

export const dynamic = "force-dynamic";

// GET — 全種類ぶんの受け取り設定（未保存の種類は既定値）
export async function GET() {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;
  try {
    return NextResponse.json({ prefs: resolvePrefs(await readSavedPrefs(email)) });
  } catch (error) {
    console.error("Failed to get notification prefs:", error);
    return NextResponse.json({ error: "設定の取得に失敗しました" }, { status: 500 });
  }
}

// PUT — body.prefs に含まれる種類だけ保存する
export async function PUT(request: NextRequest) {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;

  const body = await request.json().catch(() => ({})) as { prefs?: Record<string, Partial<KindPref>> };
  const updates: Record<string, KindPref> = {};
  for (const [id, p] of Object.entries(body.prefs ?? {})) {
    const kind = getNotificationKind(id);
    if (!kind?.configurable || typeof p?.inApp !== "boolean") continue;
    updates[id] = { inApp: p.inApp, push: kind.pushAvailable && p.push === true };
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "保存する設定がありません" }, { status: 400 });

  try {
    await writePrefs(email, updates);
    return NextResponse.json({ prefs: resolvePrefs(await readSavedPrefs(email)) });
  } catch (error) {
    console.error("Failed to save notification prefs:", error);
    return NextResponse.json({ error: "設定を保存できませんでした" }, { status: 500 });
  }
}
