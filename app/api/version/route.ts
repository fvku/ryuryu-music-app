/**
 * いま配信中のデプロイのバージョン（コミットID）を返す。
 *
 * ホーム画面から開いたアプリはバックグラウンドから戻っても再読み込みされず、
 * 古い版のまま動き続ける。components/UpdateBanner.tsx が前面復帰のたびにここを見て、
 * 自分の版と違えば再読み込みを促す。コミットIDは公開情報なので認可は付けない。
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
