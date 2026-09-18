/**
 * Release Master の行と Spotify の検索結果が同じアルバムかを判定する。
 * lib/ops/refetch-spotify.ts（管理画面・CLI）と /api/spotify/covers の共通実装。
 */

function norm(s: string) { return s.trim().toLowerCase(); }

/** [EP], [Single] 等のプレフィックスを除去してから比較 */
function stripTypePrefix(s: string) {
  return s.replace(/^\[(EP|Single|single|ep|Album|album|Compilation|compilation)\]\s*/i, "").trim();
}

export function titleMatch(sheetTitle: string, spotifyTitle: string): boolean {
  if (norm(sheetTitle) === norm(spotifyTitle)) return true;
  return norm(stripTypePrefix(sheetTitle)) === norm(stripTypePrefix(spotifyTitle));
}

/** アーティスト名を比較用に正規化（& ↔ , の揺れを吸収） */
function normArtist(s: string) { return norm(s).replace(/\s*&\s*/g, ", "); }

/** アーティスト名の一致判定（Spotifyは "A, B" 形式で複数返すことがある） */
export function artistMatch(sheetArtist: string, spotifyArtist: string): boolean {
  const a = normArtist(sheetArtist);
  const b = normArtist(spotifyArtist);
  if (a === b) return true;
  return b.includes(a) || a.includes(b);
}
