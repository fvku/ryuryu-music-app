import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAllNotificationSeen, setForYouSeenAt } from "@/lib/sheets";
import { cached, invalidateCache, CACHE_KEY, CACHE_TTL } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

// GET — ログイン中ユーザーのFor You既読時刻を返す
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const all = await cached(CACHE_KEY.NOTIFICATION_SEEN, CACHE_TTL.NOTIFICATION_SEEN, getAllNotificationSeen);
  const seenAt = all[session.user.email.toLowerCase()] || null;
  return NextResponse.json({ seenAt });
}

// POST — For You既読時刻を更新。body.seenAt があればlocalStorageからの移行値として採用、
// なければサーバー時刻で「今見た」として記録する
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  let seenAt = new Date().toISOString();
  try {
    const body = await request.json();
    if (body?.seenAt && !isNaN(new Date(body.seenAt).getTime())) {
      seenAt = new Date(body.seenAt).toISOString();
    }
  } catch {
    // body無し（通常の既読マーク）はサーバー時刻を使う
  }

  await setForYouSeenAt(session.user.email, seenAt);
  invalidateCache(CACHE_KEY.NOTIFICATION_SEEN);

  return NextResponse.json({ seenAt });
}
