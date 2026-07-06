import { randomBytes } from "crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * アルバム用の安定ID（8文字の英数字）を生成する。
 * Release Master の UID 列に保存し、行の特定に使う。
 * タイトル・アーティスト名を改名しても変わらない識別子。
 */
export function generateAlbumUid(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
