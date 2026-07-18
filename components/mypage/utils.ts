import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { EMAIL_TO_SHORT_NAME, parseLegacyScoreNum } from "@/lib/members";
import { getCombinedScore, getSummaryEntry, isSameAlbum, namesForUser, ScoreSummary } from "@/lib/score-utils";

export type ReviewFilter = "all" | "reviewed" | "unreviewed";

export function getScoreColor(score: number) {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#eab308";
  return "#ef4444";
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function applyReviewFilter(
  list: ReleaseMasterAlbum[],
  filter: ReviewFilter,
  myReviewedAlbumNos: Set<string>
): ReleaseMasterAlbum[] {
  if (filter === "reviewed") return list.filter((a) => myReviewedAlbumNos.has(a.no));
  if (filter === "unreviewed") return list.filter((a) => !myReviewedAlbumNos.has(a.no));
  return list;
}

export function combinedScoreFor(album: ReleaseMasterAlbum, scoreSummary: ScoreSummary): { avg: number; count: number } | null {
  const r = getCombinedScore(album, getSummaryEntry(scoreSummary, album)?.memberScores);
  return r.avg === null ? null : { avg: r.avg, count: r.count };
}

export function getMyScore(album: ReleaseMasterAlbum, myScores: Score[], userEmail: string): number | null {
  // 同一アルバムに複数エントリがある場合は最新のものを使う
  const matches = myScores.filter((s) => isSameAlbum(album, s));
  if (matches.length > 0) {
    const latest = matches.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
    return latest.score;
  }
  const names = namesForUser(userEmail);
  const legacy = album.legacyScores.find((ls) => names.has(ls.name.trim().toLowerCase()));
  if (legacy) return parseLegacyScoreNum(legacy.value);
  return null;
}

export const MJ_ADOPTED_VALUES = ["採用", "J採用", "掲載", "J掲載"];

export function getMjAlbums(albums: ReleaseMasterAlbum[]): ReleaseMasterAlbum[] {
  return albums.filter((a) => MJ_ADOPTED_VALUES.includes(a.mjAdoption ?? ""));
}

export function mjAdoptionOrder(v: string | undefined) {
  return (v === "採用" || v === "J採用") ? 0 : 1; // 採用→掲載
}

export function isMjPosted(album: ReleaseMasterAlbum) {
  return album.mjAdoption === "掲載" || album.mjAdoption === "J掲載";
}

export function hasMjTrack(album: ReleaseMasterAlbum) {
  return !!(album.mjTrack || album.mjTrackNo);
}

export function hasMjText(album: ReleaseMasterAlbum) {
  return hasMjTrack(album) && (isMjPosted(album) || !!(album.mjText && album.mjText.trim().length >= 80));
}

// ASSIGN列（R=17）の値から担当者名を解析
export function getAssignInfo(album: ReleaseMasterAlbum, userEmail: string): { isMe: boolean; name: string } | null {
  const a = album.mjAssign?.trim();
  if (!a) return null;
  const userShortName = (EMAIL_TO_SHORT_NAME[userEmail] ?? "").toLowerCase();
  const aLow = a.toLowerCase();
  const isMe = (userShortName && aLow === userShortName) ||
               (userEmail && aLow === userEmail.split("@")[0]);
  // 表示名：EMAIL_TO_SHORT_NAME で逆引き、なければそのまま
  const displayName = Object.entries(EMAIL_TO_SHORT_NAME).find(
    ([, name]) => name.toLowerCase() === aLow
  )?.[1] ?? a;
  return { isMe: !!isMe, name: displayName };
}
