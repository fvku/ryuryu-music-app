import { NextRequest } from "next/server";
import { getReleaseMasterAlbums } from "@/lib/release-master-albums";
import { isAuthorized } from "@/lib/api-token";
import { corsJson, corsPreflight } from "@/lib/api-cors";

export const dynamic = "force-dynamic";

/**
 * Authorization ヘッダー付きの GET はブラウザで必ずプリフライトを通るので、
 * これが無いと monthly-generator から呼べない（lib/api-cors.ts）。
 */
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return corsJson({ error: "認証が必要です" }, { status: 401 });
  }
  try {
    const albums = await getReleaseMasterAlbums();
    return corsJson(albums);
  } catch (error) {
    console.error("Failed to get Release Master albums:", error);
    return corsJson({ error: "アルバム一覧の取得に失敗しました" }, { status: 500 });
  }
}
