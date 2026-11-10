import { EMAIL_TO_SHORT_NAME } from "./members";
import type { Session } from "next-auth";

/** Preserve the existing exact-match allowlist and env-over-members precedence. */
export function isAllowedMember(email: string | null | undefined, configured = process.env.ALLOWED_MEMBER_EMAILS): boolean {
  const emails = configured?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return (emails.length ? emails : Object.keys(EMAIL_TO_SHORT_NAME)).includes(email ?? "");
}

export type MemberAccess =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403; error: string };

/** 既存JWTも毎回検証する。Spotifyの未検証メールや、失効した許可リストを信用しない。 */
export function memberAccess(session: Session | null): MemberAccess {
  const email = session?.user?.email;
  if (!email) return { ok: false, status: 401, error: "Googleでログインしてください" };
  if (!isAllowedMember(email)) return { ok: false, status: 403, error: "アクセスが許可されていません" };
  if (session?.loginProvider !== "google" || session.googleVerifiedEmail !== email) {
    return { ok: false, status: 401, error: "Googleで再ログインしてください" };
  }
  return { ok: true, email: email.toLowerCase() };
}
