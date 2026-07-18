"use client";

import { ReleaseMasterAlbum } from "@/lib/types";
import { Recommendation } from "@/lib/sheets";
import ForYouRecommendPanel from "./ForYouRecommendPanel";
import ForYouMjPanel from "./ForYouMjPanel";
import { ReviewFilter } from "./utils";

interface ForYouTabProps {
  forYou: Recommendation[];
  albums: ReleaseMasterAlbum[];
  mjAlbums: ReleaseMasterAlbum[];
  myReviewedAlbumNos: Set<string>;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  forYouMode: "recommend" | "mj";
  onForYouModeChange: (m: "recommend" | "mj") => void;
  forYouFilter: ReviewFilter;
  onForYouFilterChange: (f: ReviewFilter) => void;
  forYouMonthFilter: string;
  onForYouMonthFilterChange: (m: string) => void;
  mjMonthFilter: string;
  onMjMonthFilterChange: (m: string) => void;
  mjTypeFilter: "all" | "monthly" | "japan";
  onMjTypeFilterChange: (f: "all" | "monthly" | "japan") => void;
  userEmail: string;
  onSelectAlbum: (album: ReleaseMasterAlbum) => void;
  onSelectMjAlbum: (album: ReleaseMasterAlbum) => void;
}

/** FOR YOUタブ: レコメンド/M-J文章モードの切替と各パネルへの委譲 */
export default function ForYouTab({
  forYou, albums, mjAlbums, myReviewedAlbumNos, spotifyData,
  forYouMode, onForYouModeChange,
  forYouFilter, onForYouFilterChange, forYouMonthFilter, onForYouMonthFilterChange,
  mjMonthFilter, onMjMonthFilterChange, mjTypeFilter, onMjTypeFilterChange,
  userEmail, onSelectAlbum, onSelectMjAlbum,
}: ForYouTabProps) {
  return (
    <>
      {/* トップレベル: レコメンド / M/J 文章 — 全幅タブ */}
      <div className="flex rounded-xl overflow-hidden mb-5 border" style={{ borderColor: "var(--border-subtle)" }}>
        {(["recommend", "mj"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onForYouModeChange(mode)}
            className="flex-1 py-2.5 text-xs font-bold transition-colors"
            style={{
              backgroundColor: forYouMode === mode ? "var(--accent)" : "var(--bg-card)",
              color: forYouMode === mode ? "white" : "var(--text-secondary)",
            }}
          >
            {mode === "recommend" ? "レコメンド" : "M/J 文章"}
          </button>
        ))}
      </div>

      {forYouMode === "recommend" && (
        <ForYouRecommendPanel
          forYou={forYou}
          albums={albums}
          myReviewedAlbumNos={myReviewedAlbumNos}
          spotifyData={spotifyData}
          forYouFilter={forYouFilter}
          onForYouFilterChange={onForYouFilterChange}
          forYouMonthFilter={forYouMonthFilter}
          onForYouMonthFilterChange={onForYouMonthFilterChange}
          onSelectAlbum={onSelectAlbum}
        />
      )}

      {forYouMode === "mj" && (
        <ForYouMjPanel
          mjAlbums={mjAlbums}
          spotifyData={spotifyData}
          mjMonthFilter={mjMonthFilter}
          onMjMonthFilterChange={onMjMonthFilterChange}
          mjTypeFilter={mjTypeFilter}
          onMjTypeFilterChange={onMjTypeFilterChange}
          userEmail={userEmail}
          onSelectMjAlbum={onSelectMjAlbum}
        />
      )}
    </>
  );
}
