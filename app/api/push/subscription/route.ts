import { NextRequest, NextResponse } from "next/server";
import { requireMemberEmail } from "@/lib/notifications/session";
import { readSubscriptions, removeSubscriptions, upsertSubscription } from "@/lib/notifications/store";
import { getVapidPublicKey } from "@/lib/notifications/send";

export const dynamic = "force-dynamic";

// GET — 端末登録に使う公開鍵と、自分の登録端末数
export async function GET() {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;
  try {
    const devices = (await readSubscriptions(email)).length;
    return NextResponse.json({ publicKey: getVapidPublicKey(), devices });
  } catch (error) {
    console.error("Failed to read push subscriptions:", error);
    return NextResponse.json({ error: "通知の登録状況を取得できませんでした" }, { status: 500 });
  }
}

interface SubscriptionBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

// POST — この端末を登録する（ブラウザの PushSubscription.toJSON() をそのまま受け取る）
export async function POST(request: NextRequest) {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;

  const body = await request.json().catch(() => ({})) as { subscription?: SubscriptionBody };
  const s = body.subscription;
  const endpoint = typeof s?.endpoint === "string" ? s.endpoint : "";
  const p256dh = typeof s?.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const authKey = typeof s?.keys?.auth === "string" ? s.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || !p256dh || !authKey) {
    return NextResponse.json({ error: "端末の登録情報が不正です" }, { status: 400 });
  }

  try {
    await upsertSubscription({
      email, endpoint, p256dh, auth: authKey,
      userAgent: (request.headers.get("user-agent") ?? "").slice(0, 200),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to save push subscription:", error);
    return NextResponse.json({ error: "端末を登録できませんでした" }, { status: 500 });
  }
}

// DELETE — この端末の登録を消す（自分の登録だけ）
export async function DELETE(request: NextRequest) {
  const email = await requireMemberEmail();
  if (email instanceof NextResponse) return email;

  const body = await request.json().catch(() => ({})) as { endpoint?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  try {
    const mine = (await readSubscriptions(email)).map((s) => s.endpoint);
    await removeSubscriptions(mine.filter((e) => e === endpoint));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to remove push subscription:", error);
    return NextResponse.json({ error: "端末の登録を解除できませんでした" }, { status: 500 });
  }
}
