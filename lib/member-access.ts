import { EMAIL_TO_SHORT_NAME } from "./members";

/** Preserve the existing exact-match allowlist and env-over-members precedence. */
export function isAllowedMember(email: string | null | undefined, configured = process.env.ALLOWED_MEMBER_EMAILS): boolean {
  const emails = configured?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return (emails.length ? emails : Object.keys(EMAIL_TO_SHORT_NAME)).includes(email ?? "");
}
