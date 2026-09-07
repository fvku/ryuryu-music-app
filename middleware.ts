import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canBypassGeneratorPage } from "@/lib/generator/access";

/**
 * アプリ全体をログイン必須にする。
 *
 * 対象は画面（ページ）のみ。/api 配下はここでは扱わない —
 * リダイレクトを返すとページ用の遷移としては正しいが、fetch() で
 * JSON を期待している呼び出し元（クライアントコンポーネント）には
 * HTML が返ってきて壊れるため、API 側は各ルートで個別に認可する
 * （/api/release-master の GET は lib/api-token.ts の共有トークン、
 * 他の書き込み系ルートは既存どおり lib/auth.ts の auth() セッション）。
 */
export default auth((req) => {
  if (req.auth || canBypassGeneratorPage(req.nextUrl.pathname)) return NextResponse.next();

  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|login).*)"],
};
