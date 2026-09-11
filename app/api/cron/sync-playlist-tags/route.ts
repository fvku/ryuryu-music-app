/**
 * プレイリスト収録タグの日次クロール（Vercel Cron から叩かれる）。
 *
 * 埋め込みページから読めるのは先頭100曲までで、日付順でもない。
 * 今日リリースの曲が101曲目に居れば、その日のクロールでは見えない。
 * プレイリストは随時入れ替わるので、毎日回して観測をアーカイブに貯めれば、
 * 窓に入ってきた日に拾える。手動実行を待たずに取りこぼしを減らすための定期実行。
 *
 * 認証は CRON_SECRET。Vercel は Cron 実行時に
 * Authorization: Bearer $CRON_SECRET を付けて呼ぶ。
 */

import { NextRequest, NextResponse } from "next/server";
import { syncPlaylistTags } from "@/lib/ops/sync-playlist-tags";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const lines: string[] = [];
    const result = await syncPlaylistTags({
      apply: true,
      initColumn: true,
      log: (msg) => lines.push(msg),
    });
    if (result.written > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);

    // Vercel のログに残しておくと、取りこぼしの調査で追える
    console.log(`[cron/sync-playlist-tags]\n${lines.join("\n")}`);

    return NextResponse.json({
      month: result.month,
      scannedRows: result.scannedRows,
      written: result.written,
      unchanged: result.unchanged,
      archive: result.archive,
      webTokenBlocked: result.index.webTokenBlocked,
      fetched: result.index.fetched,
      failed: result.index.failed,
    });
  } catch (e) {
    console.error("[cron/sync-playlist-tags] failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
