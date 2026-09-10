import { NextRequest, NextResponse } from "next/server";
import { syncPlaylistTags } from "@/lib/ops/sync-playlist-tags";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { guardAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const gate = await guardAdmin(req, "sync-playlist-tags", body);
  if (!gate.ok) return gate.response;
  const { dryRun = true, month } = body;

  try {
    // playlist列が無ければ作る（空きヘッダー列に自動作成）
    const result = await syncPlaylistTags({ apply: !dryRun, initColumn: true, month });
    if (result.written > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);

    return NextResponse.json({
      dryRun,
      month: result.month,
      scannedRows: result.scannedRows,
      written: result.written,
      unchanged: result.unchanged,
      unmatchedAlbums: result.unmatchedAlbums,
      albumCount: result.index.byAlbumId.size,
      fetched: result.index.fetched,
      failed: result.index.failed,
      changes: result.changes.slice(0, 100),
      changeCount: result.changes.length,
    });
  } catch (e) {
    console.error("sync-playlist-tags failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
