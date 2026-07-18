/** ReviewModal 配下で共有する定数・ヘルパー */

export type AuthStatus = "authenticated" | "loading" | "unauthenticated";

// スライダーのなしゾーン幅。小さくするほど「なし」と「0」が近くなる (-3〜0 の間で調整)
export const NOSCORE_MIN = -1.4;

export function getScoreColor(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#eab308";
  return "#ef4444";
}

export function parseLegacyScore(value: string): { score: number | null; comment: string } {
  const trimmed = value.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    const num = parseFloat(trimmed);
    return { score: isNaN(num) ? null : num, comment: "" };
  }
  const num = parseFloat(trimmed.substring(0, spaceIdx));
  return { score: isNaN(num) ? null : num, comment: trimmed.substring(spaceIdx + 1).trim() };
}
