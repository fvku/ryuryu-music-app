import { NextRequest, NextResponse } from "next/server";
import { guardMember } from "@/lib/member-auth";
import { getAllNotificationSeen, setForYouSeenAt } from "@/lib/sheets";
import { cached, invalidateCache, CACHE_KEY, CACHE_TTL } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

// GET — ログイン中ユーザーのFor You既読時刻を返す
export async function GET(request: NextRequest) {
  const gate = await guardMember(request);
  if (!gate.ok) return gate.response;

  const all = await cached(CACHE_KEY.NOTIFICATION_SEEN, CACHE_TTL.NOTIFICATION_SEEN, getAllNotificationSeen);
  const seenAt = all[gate.email] || null;
  return NextResponse.json({ seenAt });
}

// POST — For You既読時刻を更新。body.seenAt があればlocalStorageからの移行値として採用、
// なければサーバー時刻で「今見た」として記録する
export async function POST(request: NextRequest) {
  const gate = await guardMember(request);
  if (!gate.ok) return gate.response;

  let seenAt = new Date().toISOString();
  try {
    const body = await request.json();
    if (body?.seenAt && !isNaN(new Date(body.seenAt).getTime())) {
      seenAt = new Date(body.seenAt).toISOString();
    }
  } catch {
    // body無し（通常の既読マーク）はサーバー時刻を使う
  }

  await setForYouSeenAt(gate.email, seenAt);
  invalidateCache(CACHE_KEY.NOTIFICATION_SEEN);

  return NextResponse.json({ seenAt });
}
