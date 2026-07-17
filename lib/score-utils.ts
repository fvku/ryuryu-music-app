/**
 * スコア集計の共通ロジック。
 *
 * ホーム / マイページ / ReviewModal / review/[id] / lib/sheets.ts で
 * 重複していた集計処理をここに一元化する。
 *
 * 集計仕様:
 * - 同一アルバム×同一メンバーのエントリは submittedAt が最新のもののみ有効
 * - 統合平均は Release Master のレガシースコア優先。
 *   レガシーでカバー済みのメンバーのアプリスコアは加算しない
 * - レビュー済み判定はコメントのみ（score=null）の投稿も「済み」に含める
 */

import { Score, ReleaseMasterAlbum } from "@/lib/types";
import { EMAIL_TO_SHORT_NAME, LEGACY_NAME_TO_EMAIL, parseLegacyScoreNum } from "@/lib/members";

/** アルバム特定キー（title+artist 完全一致。正規化はしない — 現行仕様） */
export function albumKey(title: string, artist: string): string {
  return `${title}::${artist}`;
}

/**
 * スコア行のアルバム特定キー。albumUid があればUID（改名に耐える）、
 * なければ従来の title+artist。
 */
export function scoreAlbumKey(s: Pick<Score, "albumUid" | "albumTitle" | "artistName">): string {
  return s.albumUid ? `uid::${s.albumUid}` : albumKey(s.albumTitle ?? "", s.artistName ?? "");
}

/**
 * 同一メンバーの重複エントリは最新のもののみ残す。
 * @param byAlbum true（既定）: アルバム×メンバー単位で重複判定。
 *                false: メンバー単位のみ（単一アルバムのスコア一覧向け）。
 */
export function dedupeLatestScores(scores: Score[], byAlbum = true): Score[] {
  const latest = new Map<string, Score>();
  for (const s of scores) {
    const key = byAlbum
      ? `${scoreAlbumKey(s)}::${s.memberName.toLowerCase()}`
      : s.memberName.toLowerCase();
    const existing = latest.get(key);
    if (!existing || s.submittedAt > existing.submittedAt) latest.set(key, s);
  }
  return Array.from(latest.values());
}

export interface ScoreSummaryEntry {
  avg: number;
  count: number;
  total: number;
  /** 投稿者（lower-case、コメントのみ含む） */
  members: Set<string>;
  /** memberName(lower-case) → score。score=null の投稿は含まない */
  memberScores: Record<string, number>;
}

export type ScoreSummary = Record<string, ScoreSummaryEntry>;

/**
 * 全スコアから集計マップを構築（メンバーごと最新のみ）。
 * キーは albumUid があれば "uid::<uid>"、なければ "title::artist"。
 * 参照側は getSummaryEntry() を使うこと。
 */
export function buildScoreSummary(scores: Score[]): ScoreSummary {
  const summary: ScoreSummary = {};
  for (const s of dedupeLatestScores(scores)) {
    const key = scoreAlbumKey(s);
    if (!summary[key]) summary[key] = { avg: 0, count: 0, total: 0, members: new Set(), memberScores: {} };
    summary[key].members.add(s.memberName.toLowerCase());
    if (s.score !== null) {
      summary[key].total += s.score;
      summary[key].count += 1;
      summary[key].memberScores[s.memberName.toLowerCase()] = s.score;
      summary[key].avg = Math.round((summary[key].total / summary[key].count) * 10) / 10;
    }
  }
  return summary;
}

/**
 * アルバムと scores/bookmarks/recommendations 行の一致判定（UID優先）。
 * 両方にUIDがあればUIDのみで判定し、どちらかが欠けていれば title+artist 完全一致。
 */
export function isSameAlbum(
  album: Pick<ReleaseMasterAlbum, "uid" | "title" | "artist">,
  row: { albumUid?: string; albumTitle?: string; artistName?: string }
): boolean {
  return album.uid && row.albumUid
    ? album.uid === row.albumUid
    : album.title === (row.albumTitle ?? "") && album.artist === (row.artistName ?? "");
}

/** アルバムに対応する集計エントリを取得（UIDキー優先、なければtitle+artistキー） */
export function getSummaryEntry(
  summary: ScoreSummary,
  album: Pick<ReleaseMasterAlbum, "uid" | "title" | "artist">
): ScoreSummaryEntry | undefined {
  return (album.uid ? summary[`uid::${album.uid}`] : undefined) ?? summary[albumKey(album.title, album.artist)];
}

/** そのユーザーを指しうる名前の集合（email・短縮名・レガシー名、すべて lower-case） */
export function namesForUser(email: string): Set<string> {
  const lower = email.toLowerCase();
  const names = new Set<string>([lower]);
  const short = EMAIL_TO_SHORT_NAME[lower];
  if (short) names.add(short.toLowerCase());
  for (const [name, e] of Object.entries(LEGACY_NAME_TO_EMAIL)) {
    if (e === lower) names.add(name.toLowerCase());
  }
  return names;
}

/**
 * 統合平均: Release Master のレガシースコア優先。
 * アプリスコア（memberScores）はレガシーでカバーされていないメンバー分のみ加算。
 */
export function getCombinedScore(
  album: Pick<ReleaseMasterAlbum, "legacyScores">,
  memberScores: Record<string, number> | undefined
): { avg: number | null; count: number } {
  const legacyCoveredIds = new Set<string>();
  let legacyTotal = 0;
  let legacyCount = 0;
  for (const ls of album.legacyScores) {
    const n = parseLegacyScoreNum(ls.value);
    if (n !== null && n >= 0 && n <= 10) {
      legacyTotal += n;
      legacyCount++;
      const email = LEGACY_NAME_TO_EMAIL[ls.name.toLowerCase()];
      if (email) legacyCoveredIds.add(email);
      legacyCoveredIds.add(ls.name.toLowerCase());
    }
  }
  let appOnlyTotal = 0;
  let appOnlyCount = 0;
  for (const [member, score] of Object.entries(memberScores ?? {})) {
    if (!legacyCoveredIds.has(member)) {
      appOnlyTotal += score;
      appOnlyCount++;
    }
  }
  const total = legacyTotal + appOnlyTotal;
  const count = legacyCount + appOnlyCount;
  if (count === 0) return { avg: null, count: 0 };
  return { avg: Math.round((total / count) * 10) / 10, count };
}

/** Score[] → memberScores 形式（getCombinedScore に渡す用。score=null は除外） */
export function toMemberScores(scores: Score[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of scores) {
    if (s.score !== null) map[s.memberName.toLowerCase()] = s.score;
  }
  return map;
}

/**
 * 自分がレビュー済みのアルバムNoセット。
 * アプリスコア（コメントのみ含む）とレガシースコアの両方を見る。
 */
export function getMyReviewedAlbumNos(
  albums: ReleaseMasterAlbum[],
  scores: Score[],
  userEmail: string
): Set<string> {
  const names = namesForUser(userEmail);
  const reviewed = new Set<string>();
  const titleArtistToNo = new Map(albums.map((a) => [albumKey(a.title, a.artist), a.no]));
  const uidToNo = new Map(albums.filter((a) => a.uid).map((a) => [a.uid, a.no]));
  for (const s of scores) {
    if (!names.has(s.memberName.trim().toLowerCase())) continue;
    const no =
      (s.albumUid ? uidToNo.get(s.albumUid) : undefined) ??
      titleArtistToNo.get(albumKey(s.albumTitle ?? "", s.artistName ?? ""));
    if (no) reviewed.add(no);
  }
  for (const a of albums) {
    if (a.legacyScores.some((ls) => names.has(ls.name.trim().toLowerCase()))) {
      reviewed.add(a.no);
    }
  }
  return reviewed;
}
