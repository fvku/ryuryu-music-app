import { NextResponse } from "next/server";
import { requireMemberEmail } from "@/lib/notifications/session";
import { readNotifications, readSavedPrefs } from "@/lib/notifications/store";
import { computeAlerts } from "@/lib/notifications/alerts";
import { resolvePrefs, type InboxResponse } from "@/lib/notifications/kinds";

export const dynamic = "force-dynamic";

// GET — ベル一覧。今のアラートを先頭に、送られた通知を新しい順で続ける
export async function GET() {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;

  try {
    const prefs = resolvePrefs(await readSavedPrefs(email));
    const [alerts, messages] = await Promise.all([computeAlerts(email, prefs), readNotifications(email)]);
    const visibleMessages = messages.filter((m) => prefs[m.kind]?.inApp ?? true);
    const body: InboxResponse = {
      items: [...alerts, ...visibleMessages],
      badgeCount: alerts.length + visibleMessages.filter((m) => !m.readAt).length,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("Failed to get notifications:", error);
    return NextResponse.json({ error: "お知らせの取得に失敗しました" }, { status: 500 });
  }
}
