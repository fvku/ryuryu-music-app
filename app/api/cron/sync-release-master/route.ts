import { NextRequest, NextResponse } from "next/server";
import { guardMember } from "@/lib/member-auth";
import { assignUids } from "@/lib/ops/assign-uids";
import { backfillAlbumUids } from "@/lib/ops/backfill-album-uids";
import { runReviewSync } from "@/lib/ops/review-sync";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { logCronResult } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Release Master ⇄ アプリのレビュー同期（2026-11-10 作り直し）。
 *
 * 以前は「初めて見つけた差分を2分待って、見つけた時刻でアプリへ上書き」していたため、
 * Release Master への反映に失敗した新しいレビューを、シートの古い内容で戻してしまうことがあった。
 * 今は `_review_edit_log` の記録時刻でアプリより新しいと確かめられたものだけを反映し、
 * それ以外の差分は管理画面の確認待ち（sync_review シート）へ回す。判定は lib/review-sync.ts。
 *
 * 起動は2通り: Vercel Cron（毎日、CRON_SECRET）と、ホームを開いたときのメンバーのPOST。
 * 何度実行しても結果は同じ（冪等）なので、別インスタンスで同時に走っても壊れない。
 */
const THROTTLE_MS = 5 * 60 * 1000; // ホームからの起動の間隔の下限（同一インスタンス）

let lastRunAt = 0;
let running = false;

/** 定期実行は共有のCron認証。ブラウザからのGETでシートを書き換えない。 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return syncReleaseMaster({ fromCron: true });
}

/** ホームからの同期は、検証済みメンバーによる同一オリジンPOSTに限定する。 */
export async function POST(request: NextRequest) {
  const gate = await guardMember(request);
  if (!gate.ok) return gate.response;
  return syncReleaseMaster({ fromCron: false });
}

async function syncReleaseMaster({ fromCron }: { fromCron: boolean }) {
  if (running) return NextResponse.json({ ok: true, skipped: "already-running" });
  if (!fromCron && Date.now() - lastRunAt < THROTTLE_MS) return NextResponse.json({ ok: true, skipped: "throttled" });
  running = true;
  try {
    // UID自動採番＋紐付けを先に行う（同期は uid×メンバーで照合するため）。失敗しても同期は続ける
    let uidsAssigned = 0;
    let uidError: string | null = null;
    try {
      const assignResult = await assignUids({ apply: true });
      uidsAssigned = assignResult.assigned;
      if (uidsAssigned > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
      const backfillResult = await backfillAlbumUids({ apply: true });
      const scoresLinked = backfillResult.sheets.find((s) => s.sheet === "scores");
      if (scoresLinked && scoresLinked.exactHit + scoresLinked.lowerHit > 0) invalidateCache(CACHE_KEY.SCORES);
    } catch (e) {
      uidError = "UIDの自動採番・紐付けに失敗しました";
      console.error("UID assign/backfill failed:", e);
    }

    const result = await runReviewSync({ apply: true });
    lastRunAt = Date.now();
    const summary = {
      applied: result.applied.length, review: result.reviewCount, reviewByReason: result.reviewByReason,
      journalAvailable: result.journalAvailable, uidsAssigned, uidError,
    };
    // 毎回のホーム訪問で記録を増やさないよう、Cron の実行と、実際に反映したときだけ残す
    if (fromCron || result.applied.length > 0 || uidError) logCronResult("sync-release-master", !uidError, summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("Release Master sync failed:", error);
    logCronResult("sync-release-master", false, { error: error instanceof Error ? error.message : String(error), fromCron });
    return NextResponse.json({ error: "Release Masterの同期に失敗しました" }, { status: 500 });
  } finally {
    running = false;
  }
}
