/**
 * 取り込み候補が Release Master の既存の行と同じ作品かどうかの「ゆるい」照合。
 *
 * 作品名＋アーティスト名の完全一致（releaseKey）と Spotify のアルバムIDでは、
 * 取り込み元による表記の差を拾えない（2026-11-06 実データ）。
 *   - AOTY:「Hisaishi: Symphonic Suite The Boy and The Heron …」／「久石譲 & Royal Philharmonic Orchestra」
 *   - NMF :「Symphonic Suite The Boy and the Heron …」／「Joe Hisaishi, Royal Philharmonic Orchestra」
 *   - 邦楽は作品名がローマ字表記と日本語表記で揺れる（"ao wo komete" と「青を込めて」）
 * そこで配信日が前後7日以内の行に限って、次のどちらかに当たれば同じ作品とみなす。
 *   1. 名義を「,」「&」「feat.」などで分けたどれかが一致する
 *   2. 作品名（記号・空白・[EP] を除いたもの）の一方がもう一方を含む（短い作品名は誤爆するので6文字以上）
 */

export interface ExistingRelease {
  rowNum: number;
  /** "YYYY/MM/DD" */
  date: string;
  title: string;
  artist: string;
}

export interface ReleaseLike {
  /** "YYYY-MM-DD" */
  date: string;
  title: string;
  artistNames: string[];
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TITLE_LENGTH = 6;

/** 名義を個々のアーティストに分ける */
export function splitArtists(name: string): string[] {
  return (name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    // "and" / "x" / "with" / "/" は名義そのもの（Christine and the Queens / Lil Nas X / AC/DC）を壊すので区切りにしない
    .split(/\s*(?:,|&|＆|、|×|\bfeat\.?|\bft\.)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeTitle(title: string): string {
  return (title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\[(ep|single|album|compilation)[\]}]\s*/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function toTime(date: string): number {
  return Date.parse(`${date.replace(/\//g, "-")}T00:00:00Z`);
}

/** 同じ作品とみなせる既存の行番号。無ければ null */
export function findNearbyDuplicate(existing: ExistingRelease[], release: ReleaseLike): number | null {
  const target = toTime(release.date);
  if (Number.isNaN(target)) return null;
  const artists = new Set(release.artistNames.flatMap(splitArtists));
  const title = normalizeTitle(release.title);

  for (const row of existing) {
    const time = toTime(row.date);
    if (Number.isNaN(time) || Math.abs(time - target) > WINDOW_MS) continue;
    if (splitArtists(row.artist).some((a) => artists.has(a))) return row.rowNum;
    const other = normalizeTitle(row.title);
    if (title.length >= MIN_TITLE_LENGTH && other.length >= MIN_TITLE_LENGTH && (title.includes(other) || other.includes(title))) {
      return row.rowNum;
    }
  }
  return null;
}
