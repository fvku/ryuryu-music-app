"use client";

import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { ScoreSummary } from "@/lib/score-utils";
import AlbumRow from "./AlbumRow";
import { applyReviewFilter, ReviewFilter } from "./utils";

interface SavedTabProps {
  bookmarkedAlbums: ReleaseMasterAlbum[];
  myReviewedAlbumNos: Set<string>;
  savedFilter: ReviewFilter;
  onSavedFilterChange: (f: ReviewFilter) => void;
  savedMonthFilter: string;
  onSavedMonthFilterChange: (m: string) => void;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  scoreSummary: ScoreSummary;
  myScores: Score[];
  userEmail: string;
  onSelectAlbum: (album: ReleaseMasterAlbum) => void;
}

/** SAVEDタブ: 保存済みアルバムの月/レビュー状況フィルターと一覧 */
export default function SavedTab({
  bookmarkedAlbums, myReviewedAlbumNos,
  savedFilter, onSavedFilterChange, savedMonthFilter, onSavedMonthFilterChange,
  spotifyData, scoreSummary, myScores, userEmail, onSelectAlbum,
}: SavedTabProps) {
  const savedMonths = ["すべて", ...Array.from(new Set(bookmarkedAlbums.map((a) => a.date?.substring(0, 7)).filter(Boolean))).sort().reverse()];
  const filteredSaved = applyReviewFilter(bookmarkedAlbums, savedFilter, myReviewedAlbumNos).filter((a) =>
    savedMonthFilter === "すべて" || a.date?.substring(0, 7) === savedMonthFilter
  );

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <select
          value={savedMonthFilter}
          onChange={(e) => onSavedMonthFilterChange(e.target.value)}
          className="px-3 py-1 rounded-xl border text-xs font-medium focus:outline-none flex-shrink-0"
          style={{ backgroundColor: "var(--bg-card)", borderColor: savedMonthFilter !== "すべて" ? "var(--accent)" : "var(--border-subtle)", color: savedMonthFilter !== "すべて" ? "white" : "var(--text-secondary)" }}
        >
          {savedMonths.map((m) => (
            <option key={m} value={m}>{m === "すべて" ? "すべて" : `${m.split("/")[0]}年${parseInt(m.split("/")[1])}月`}</option>
          ))}
        </select>
        {(["all", "unreviewed", "reviewed"] as ReviewFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => onSavedFilterChange(f)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
            style={{
              backgroundColor: savedFilter === f ? "rgba(139,92,246,0.3)" : "var(--bg-card)",
              color: savedFilter === f ? "white" : "var(--text-secondary)",
              border: `1px solid ${savedFilter === f ? "var(--accent)" : "var(--border-subtle)"}`,
            }}
          >
            {f === "all" ? "すべて" : f === "reviewed" ? "レビュー済み" : "未レビュー"}
          </button>
        ))}
      </div>
      {filteredSaved.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">🔖</p>
          <p style={{ color: "var(--text-secondary)" }}>
            {savedFilter === "all" ? "保存されたアルバムはありません" : "該当するアルバムはありません"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredSaved.map((album) => (
            <AlbumRow key={album.no} album={album} spotifyData={spotifyData} scoreSummary={scoreSummary} myScores={myScores} userEmail={userEmail} onSelect={onSelectAlbum} />
          ))}
        </div>
      )}
    </>
  );
}
