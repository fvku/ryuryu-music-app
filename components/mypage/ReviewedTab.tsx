"use client";

import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { ScoreSummary } from "@/lib/score-utils";
import AlbumRow from "./AlbumRow";

interface ReviewedTabProps {
  reviewedAlbums: ReleaseMasterAlbum[];
  reviewedSearch: string;
  onReviewedSearchChange: (v: string) => void;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  scoreSummary: ScoreSummary;
  myScores: Score[];
  userEmail: string;
  onSelectAlbum: (album: ReleaseMasterAlbum) => void;
}

/** REVIEWEDタブ: レビュー済みアルバムの検索と一覧 */
export default function ReviewedTab({
  reviewedAlbums, reviewedSearch, onReviewedSearchChange,
  spotifyData, scoreSummary, myScores, userEmail, onSelectAlbum,
}: ReviewedTabProps) {
  const q = reviewedSearch.trim().toLowerCase();
  const filtered = q
    ? reviewedAlbums.filter((a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
    : reviewedAlbums;

  return (
    <>
      {reviewedAlbums.length > 0 && (
        <div className="mb-4 relative">
          <input
            type="text"
            value={reviewedSearch}
            onChange={(e) => onReviewedSearchChange(e.target.value)}
            placeholder="アーティスト名・アルバム名で検索..."
            className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50 pr-10"
            style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
          />
          {reviewedSearch && (
            <button
              onClick={() => onReviewedSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-xs"
              style={{ backgroundColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              ✕
            </button>
          )}
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">⭐</p>
          <p style={{ color: "var(--text-secondary)" }}>{reviewedAlbums.length === 0 ? "まだレビューがありません" : "該当するアルバムはありません"}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((album) => (
            <AlbumRow key={album.no} album={album} reviewedMode spotifyData={spotifyData} scoreSummary={scoreSummary} myScores={myScores} userEmail={userEmail} onSelect={onSelectAlbum} />
          ))}
        </div>
      )}
    </>
  );
}
