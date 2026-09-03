import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

/**
 * 外部ツール向けの共有トークン認証。
 *
 * NextAuth のセッションCookieはブラウザの同一オリジン前提で、
 * 単一HTMLファイルとして配布している monthly-generator（漂流音楽/tools/monthly-generator）
 * のような別オリジンの静的ツールからは素直に使えない（クロスオリジンで
 * Cookie を渡すには Access-Control-Allow-Credentials 等の追加設定が要り、
 * ツール側もログインフローを持つ必要が出て「開くだけで使える」設計が崩れる）。
 *
 * そのため、そうした外部ツール専用の読み取りエンドポイントは
 * `Authorization: Bearer <RELEASE_MASTER_API_TOKEN>` の共有トークンで守る。
 * トークンが漏れた場合は環境変数を差し替えるだけで失効させられる。
 */
export function checkApiToken(request: NextRequest): boolean {
  const expected = process.env.RELEASE_MASTER_API_TOKEN;
  if (!expected) return false; // トークン未設定なら常に拒否（設定漏れで無認証公開になる事故を防ぐ）

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return match[1] === expected;
}

/**
 * このアプリ自身のフロントエンド（ログイン済みセッションの通常ブラウザアクセス）か、
 * monthly-generator のような外部ツール（共有トークン）か、どちらかであれば許可する。
 * 認証は middleware.ts でアプリの画面自体をログイン必須にした上で、
 * /api 配下は matcher から除外しているため、ここで両方の入り口を見る。
 */
export async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (checkApiToken(request)) return true;
  const session = await auth();
  return !!session?.user?.email;
}
