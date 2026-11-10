import { NextRequest, NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { REFRESH_COOKIE, REFRESH_COOKIE_MAX_AGE, refreshCookieOptions, STATE_COOKIE, stateCookieOptions } from "@/lib/spotify-oauth-cookie";

export const dynamic = "force-dynamic";

type PopupMessage =
  | { type: "SPOTIFY_AUTH_ERROR"; error: "cancelled" | "state_mismatch" | "token_exchange_failed" }
  | { type: "SPOTIFY_AUTH_SUCCESS"; token: string; expiresIn: number };

function htmlResponse(message: PopupMessage, status = 200, refreshToken?: string) {
  // JSONの引用符処理だけではHTMLの </script> を防げない。外部由来のトークンも含め、
  // script内へ入れるデータはHTMLパーサーが要素として扱えない形にする。
  const payload = JSON.stringify(message)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const nonce = randomBytes(16).toString("base64");
  const script = `window.opener?.postMessage(${payload},window.location.origin);window.close();`;
  const res = new NextResponse(
    `<!DOCTYPE html><html><body><script nonce="${nonce}">${script}</script></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      },
    }
  );
  // 成功・拒否・エラーのどの終了経路でも、ブラウザに残したstateを消費する。
  res.cookies.set(STATE_COOKIE, "", stateCookieOptions(0));
  if (refreshToken) {
    res.cookies.set(REFRESH_COOKIE, refreshToken, refreshCookieOptions(REFRESH_COOKIE_MAX_AGE));
  }
  return res;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  // エラー応答にもstate照合を適用し、照合前にはトークン交換もCookie保存もしない。
  if (!state || !expectedState
    || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(expectedState)
    || !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
    return htmlResponse({ type: "SPOTIFY_AUTH_ERROR", error: "state_mismatch" }, 400);
  }

  if (error || !code) {
    // プロバイダーのerrorクエリ自体はHTMLへ反映しない。
    return htmlResponse({ type: "SPOTIFY_AUTH_ERROR", error: "cancelled" });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/spotify-oauth/callback`;

  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("token_exchange_failed");

    const data = await res.json();
    if (typeof data?.access_token !== "string" || !data.access_token
      || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new Error("invalid_token_response");
    }
    return htmlResponse(
      { type: "SPOTIFY_AUTH_SUCCESS", token: data.access_token, expiresIn: data.expires_in },
      200,
      typeof data.refresh_token === "string" ? data.refresh_token : undefined
    );
  } catch {
    return htmlResponse({ type: "SPOTIFY_AUTH_ERROR", error: "token_exchange_failed" }, 502);
  }
}
