import { NextRequest, NextResponse } from "next/server";
import { syncPlaylistTags } from "@/lib/ops/sync-playlist-tags";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { checkAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { adminPassword, dryRun = true } = await req.json();
  if (!checkAdminPassword(adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // playlist列が無ければ作る（空きヘッダー列に自動作成）
    const result = await syncPlaylistTags({ apply: !dryRun, initColumn: true });
    if (result.written > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);

    return NextResponse.json({
      dryRun,
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
