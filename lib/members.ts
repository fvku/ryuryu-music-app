export const EMAIL_TO_SHORT_NAME: Record<string, string> = {
  "kohei.fuku0926@gmail.com": "Kohei",
  "akyme68@gmail.com": "Meri",
  "yoshinorihnw@gmail.com": "Hanawa",
  "edwardcannell93@gmail.com": "Eddie",
  "kwisoo1102@gmail.com": "Kwisoo",
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
