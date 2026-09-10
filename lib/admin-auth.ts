/**
 * 管理画面の認可。
 *
 * 以前は共有の管理者パスワードだったが、パスワードの打ち間違いが
 * 全操作の Unauthorized として現れて原因が分かりにくかったため、
 * アプリ本体と同じ Google ログインへ寄せた（2026-09-11）。
 *
 * 判定は3段構え:
 *   1. 同一サイトからの操作か（CSRF対策）
 *   2. Googleでログイン済みの許可メンバーか（ジェネレーターと同じ検証）
 *   3. そのうえで管理者か（ADMIN_EMAILS。未設定ならKoheiのみ）
 *
 * 誰が何を実行したかは admin_logs シートに追記する。
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { getGoogleAuth } from "@/lib/google-auth";
import { isAllowedMember } from "@/lib/member-access";

const LOG_SHEET = "admin_logs";

/** ADMIN_EMAILS 未設定時の既定の管理者 */
const DEFAULT_ADMIN_EMAILS = ["kohei.fuku0926@gmail.com"];

export function isAdminEmail(
  email: string | null | undefined,
  configured = process.env.ADMIN_EMAILS
): boolean {
  const list = configured?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  return (list.length ? list : DEFAULT_ADMIN_EMAILS).includes(email ?? "");
}

/** 同一サイトからの操作かを確認する（lib/generator/access.ts と同じ考え方） */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin";
}

/** admin_logs シートが無ければ作る */
async function ensureLogSheet(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  if (meta.data.sheets?.some((s) => s.properties?.title === LOG_SHEET)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: LOG_SHEET } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${LOG_SHEET}!A1:E1`,
    valueInputOption: "RAW",
    requestBody: { values: [["timestamp", "email", "action", "result", "detail"]] },
  });
}

/**
 * 実行ログを1行追記する。
 * ログの失敗で操作そのものを止めたくないので、例外は握りつぶす。
 */
export async function logAdminAction(
  email: string,
  action: string,
  result: "ok" | "denied",
  detail: unknown = {}
): Promise<void> {
  try {
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!spreadsheetId) return;

    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth(true) });
    await ensureLogSheet(sheets, spreadsheetId);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${LOG_SHEET}!A:E`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[new Date().toISOString(), email, action, result, JSON.stringify(detail ?? {})]],
      },
    });
  } catch (e) {
    console.error("admin log failed:", e);
  }
}

export type AdminGate =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

/**
 * 管理者かどうかを確認し、通れば実行ログを残す。
 * 弾いた場合も理由つきでログに残す（誤操作の切り分け用）。
 */
export async function guardAdmin(
  request: Request,
  action: string,
  detail: unknown = {}
): Promise<AdminGate> {
  // ログイン前や外部からの呼び出しは誰でも起こせるのでログに残さない。
  // 残すのは「ログイン済みだが権限が足りない」ケースだけにする。
  const deny = (status: number, message: string, email = "", reason = ""): AdminGate => {
    if (email) void logAdminAction(email, action, "denied", { reason });
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  };

  if (!isSameOrigin(request)) return deny(403, "同じサイトから操作してください");

  const session = await auth();
  const email = session?.user?.email ?? "";
  if (!email) return deny(401, "Googleでログインしてください");
  if (!isAllowedMember(email)) return deny(403, "アクセスが許可されていません", email, "not-member");
  if (session?.loginProvider !== "google" || session?.googleVerifiedEmail !== email) {
    return deny(401, "Googleで再ログインしてください", email, "google-reauth-required");
  }
  if (!isAdminEmail(email)) return deny(403, "管理者権限がありません", email, "not-admin");

  void logAdminAction(email, action, "ok", detail);
  return { ok: true, email };
}
