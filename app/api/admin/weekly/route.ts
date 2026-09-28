import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/admin-auth";
import { invalidateCache, CACHE_KEY } from "@/lib/api-cache";
import { parseAotyText } from "@/lib/weekly/aoty-parse";
import { isFriday, weekWindow } from "@/lib/weekly/week";
import { addReleases, japaneseCandidates, readWeekRows, releaseMasterUrl, westernCandidates, type NewRelease } from "@/lib/ops/weekly";
import { refetchSpotifyUrls } from "@/lib/ops/refetch-spotify";
import { fillTimeTracks } from "@/lib/ops/fill-time-tracks";
import { fillListeners } from "@/lib/ops/fill-listeners";
import { syncPlaylistTags } from "@/lib/ops/sync-playlist-tags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 週次リリース作業ページ（/weekly）のAPI。
 *
 * action:
 *   status          今週の行の一覧
 *   western-preview AOTYの貼り付けテキストを解析して候補を返す（書き込まない）
 *   japan-preview   New Music Wednesday から邦楽の候補を返す（書き込まない）
 *   add             選んだ候補を Release Master に追加する
 *   refresh         今週の行について、Spotify URL / Time / リスナー / 収録タグ のどれか1段を実行する
 */
type Body =
  | { action: "status"; friday: string }
  | { action: "western-preview"; friday: string; text: string }
  | { action: "japan-preview"; friday: string; playlistUrl: string }
  | { action: "add"; friday: string; releases: NewRelease[] }
  | { action: "refresh"; friday: string; step: "spotify" | "time" | "listeners" | "playlists" };

/** 書き込みを伴う操作だけ admin_logs に詳細を残す（閲覧のたびにログを増やさない） */
function logDetail(body: Body) {
  switch (body.action) {
    case "add": return { friday: body.friday, count: body.releases?.length ?? 0 };
    case "refresh": return { friday: body.friday, step: body.step };
    default: return { friday: body.friday };
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const gate = await guardAdmin(req, `weekly:${body.action}`, logDetail(body));
  if (!gate.ok) return gate.response;

  if (!body.friday || !isFriday(body.friday)) {
    return NextResponse.json({ error: "対象週は金曜日の日付（YYYY-MM-DD）で指定してください" }, { status: 400 });
  }
  const window = weekWindow(body.friday);
  const dateRange = { from: window.sheetFrom, to: window.sheetTo };

  try {
    switch (body.action) {
      case "status": {
        const rows = await readWeekRows(window);
        const sheetUrl = await releaseMasterUrl(rows[0]?.rowNum);
        return NextResponse.json({ window, rows, sheetUrl });
      }

      case "western-preview": {
        const { entries, skipped } = parseAotyText(body.text ?? "", body.friday);
        return NextResponse.json({ candidates: await westernCandidates(entries, window), skipped });
      }

      case "japan-preview":
        return NextResponse.json(await japaneseCandidates(body.playlistUrl ?? "", window));

      case "add": {
        const result = await addReleases(Array.isArray(body.releases) ? body.releases : []);
        if (result.added.length > 0) invalidateCache(CACHE_KEY.RELEASE_MASTER);
        return NextResponse.json(result);
      }

      case "refresh": {
        let result: unknown;
        if (body.step === "spotify") result = await refetchSpotifyUrls({ apply: true, dateRange });
        else if (body.step === "time") result = await fillTimeTracks({ apply: true, dateRange });
        else if (body.step === "listeners") result = await fillListeners({ apply: true, dateRange });
        else if (body.step === "playlists") {
          const synced = await syncPlaylistTags({ apply: true, dateRange });
          // 索引・アーカイブの全件は重いので、画面に要る分だけ返す
          result = {
            written: synced.written,
            scannedRows: synced.scannedRows,
            fetched: synced.index.fetched.length,
            failed: synced.index.failed.map((f) => f.label),
            changes: synced.changes.map((c) => ({ rowNum: c.rowNum, title: c.title, artist: c.artist, added: c.added })),
          };
        } else {
          return NextResponse.json({ error: "不明な処理です" }, { status: 400 });
        }
        invalidateCache(CACHE_KEY.RELEASE_MASTER);
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: "不明な操作です" }, { status: 400 });
    }
  } catch (e) {
    console.error(`weekly ${body.action} failed:`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
