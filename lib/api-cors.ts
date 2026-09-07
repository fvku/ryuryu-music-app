import { NextResponse } from "next/server";

/**
 * 外部ツール向けの読み取りエンドポイントに CORS を許す。
 *
 * lib/api-token.ts が書いている通り、/api/release-master の GET は
 * 単一HTMLとして配布している monthly-generator（漂流音楽/tools/monthly-generator）から
 * 呼ばれる。ところが `Authorization` ヘッダー付きの GET は必ず OPTIONS の
 * プリフライトを通るため、CORS ヘッダーが無いとブラウザから一切呼べない
 * （curl や node は CORS を無視するので、サーバー側の実装だけ見ていると気づかない）。
 *
 * ## なぜ Allow-Origin: * で安全か
 *
 * ワイルドカードの ACAO は**資格情報つきのリクエストには使えない**という仕様上の制約があり、
 * ブラウザは Cookie を伴うクロスオリジンのレスポンスを読ませない。
 * したがってこの設定で、第三者のサイトが訪問者の next-auth セッションを使って
 * データを読み出すことはできない。読めるのは `Authorization: Bearer <RELEASE_MASTER_API_TOKEN>`
 * を明示的に付けた呼び出しだけで、トークンを持たなければ従来どおり 401 が返る。
 * つまり増える露出は「トークンを持っている人がブラウザからも読める」ことだけで、
 * それがまさに monthly-generator の要件そのもの。
 *
 * ## 書き込みには効かせない
 *
 * Allow-Methods に GET と OPTIONS しか載せないので、
 * /api/release-master/[no] の PATCH はクロスオリジンからは従来どおりプリフライトで弾かれる。
 * PATCH は next-auth のセッションで守られており、その認可には手を入れていない。
 */
export const READ_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

/**
 * NextResponse.json の代わりに使う。エラー応答にも CORS を付けるのが要点で、
 * 401 に ACAO が無いとブラウザ側はステータスを読めず「通信できなかった」としか分からない。
 */
export function corsJson(body: unknown, init?: ResponseInit): NextResponse {
  const given = (init?.headers as Record<string, string> | undefined) ?? {};
  return NextResponse.json(body, { ...init, headers: { ...given, ...READ_CORS_HEADERS } });
}

/** OPTIONS プリフライトへの応答 */
export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: READ_CORS_HEADERS });
}
