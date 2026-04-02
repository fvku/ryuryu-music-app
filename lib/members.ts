export const EMAIL_TO_SHORT_NAME: Record<string, string> = {
  "kohei.fuku0926@gmail.com": "Kohei",
  "akyme68@gmail.com": "Meri",
  "yoshinorihnw@gmail.com": "Hanawa",
  "edwardcannell93@gmail.com": "Eddie",
  "kwisoo1102@gmail.com": "Kwisoo",
};

// Known legacy name variants (lower-cased) → canonical email
// Used for backward-compat lookup of old entries stored with short or full names
export const LEGACY_NAME_TO_EMAIL: Record<string, string> = {
  "kohei": "kohei.fuku0926@gmail.com",
  "kohei fukuda": "kohei.fuku0926@gmail.com",
  "meri": "akyme68@gmail.com",
  "hanawa": "yoshinorihnw@gmail.com",
  "eddie": "edwardcannell93@gmail.com",
  "kwisoo": "kwisoo1102@gmail.com",
};

// Column index (0-based from column A) for Release Master columns V–Z
export const MEMBER_COLUMN_INDEX: Record<string, number> = {
  "Kwisoo": 21, // V
  "Meri": 22,   // W
  "Kohei": 23,  // X
  "Eddie": 24,  // Y
  "Hanawa": 25, // Z
};

export function getMemberShortName(email: string | null | undefined): string | null {
  if (!email) return null;
  return EMAIL_TO_SHORT_NAME[email.toLowerCase()] ?? null;
}

/** メールアドレスまたは旧来の名前から表示用短縮名を返す */
export function getDisplayName(memberName: string): string {
  if (!memberName) return memberName;
  const lower = memberName.toLowerCase();
  return EMAIL_TO_SHORT_NAME[lower] ?? memberName;
}

/** メールアドレス → Release Master照合用の短縮名（V〜Z列キー） */
export function getShortNameForReleaseMaster(email: string): string | null {
  return EMAIL_TO_SHORT_NAME[email.toLowerCase()] ?? null;
}

/** 旧名前エントリをemailに正規化する（後方互換） */
export function normalizeToEmail(memberName: string): string | null {
  const lower = memberName.toLowerCase();
  if (EMAIL_TO_SHORT_NAME[lower]) return lower; // 既にemail
  return LEGACY_NAME_TO_EMAIL[lower] ?? null;
}
