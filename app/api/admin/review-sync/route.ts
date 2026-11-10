import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/admin-auth";
import { getReviewQueue, resolveReviewQueueItem, runReviewSync } from "@/lib/ops/review-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * レビュー同期の確認待ち（sync_review）。
 * - action=list: 一覧（読み取りだけなのでログに残さない）
 * - action=run: 同期を今すぐ実行（dryRun=true なら書かずに件数だけ）
 * - action=resolve: 1件を「シートの内容を採用（adopt_rm）」「アプリの内容を残す（keep_app）」で解消
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const gate = await guardAdmin(req, `review-sync:${action}`, action === "list" ? {} : body);
  if (!gate.ok) return gate.response;

  try {
    if (action === "list") {
      return NextResponse.json({ items: await getReviewQueue() });
    }
    if (action === "run") {
      const result = await runReviewSync({ apply: body.dryRun !== true });
      return NextResponse.json({ ...result, items: body.dryRun === true ? undefined : await getReviewQueue() });
    }
    if (action === "resolve") {
      const { key, resolution, expected } = body ?? {};
      if (typeof key !== "string" || (resolution !== "adopt_rm" && resolution !== "keep_app")
        || typeof expected?.rmValue !== "string" || typeof expected?.appSubmittedAt !== "string") {
        return NextResponse.json({ error: "key・resolution・expected が必要です" }, { status: 400 });
      }
      const result = await resolveReviewQueueItem({ key, action: resolution, expected, actorEmail: gate.email });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
      return NextResponse.json({ ok: true, items: await getReviewQueue() });
    }
    return NextResponse.json({ error: "不明な action です" }, { status: 400 });
  } catch (e) {
    console.error("review-sync admin failed:", e);
    return NextResponse.json({ error: "レビュー同期の処理に失敗しました" }, { status: 500 });
  }
}
