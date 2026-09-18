"use client";

import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { Recommendation } from "@/lib/sheets";
import { isSameAlbum, ScoreSummary } from "@/lib/score-utils";
import { ListenMode } from "@/hooks/useMyPageData";
import SegmentTabs from "./SegmentTabs";
import MonthSelect, { monthsOf } from "./MonthSelect";
import SavedList from "./SavedList";
import RecommendList from "./RecommendList";
import { applyReviewFilter, ReviewFilter } from "./utils";

interface ListenTabProps {
  bookmarkedAlbums: ReleaseMasterAlbum[];
  forYou: Recommendation[];
  albums: ReleaseMasterAlbum[];
  myReviewedAlbumNos: Set<string>;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  scoreSummary: ScoreSummary;
  myScores: Score[];
  userEmail: string;
  listenMode: ListenMode;
  onListenModeChange: (m: ListenMode) => void;
  listenFilter: ReviewFilter;
  onListenFilterChange: (f: ReviewFilter) => void;
  listenMonthFilter: string;
  onListenMonthFilterChange: (m: string) => void;
  unreviewedRecCount: number;
  hasNewForYou: boolean;
  onSelectAlbum: (album: ReleaseMasterAlbum) => void;
}

/** LISTENタブ: SAVED / RECOMMEND の切替。月・レビュー状況のフィルターは両方で共有する */
export default function ListenTab({
  bookmarkedAlbums, forYou, albums, myReviewedAlbumNos, spotifyData, scoreSummary, myScores, userEmail,
  listenMode, onListenModeChange, listenFilter, onListenFilterChange, listenMonthFilter, onListenMonthFilterChange,
  unreviewedRecCount, hasNewForYou, onSelectAlbum,
}: ListenTabProps) {
  const recItems = forYou.map((rec) => ({ rec, album: albums.find((a) => isSameAlbum(a, rec)) }));

  // 月の選択肢は両方の一覧の月を合わせたもの（切り替えても選んだ月が選択肢から消えないように）
  const months = monthsOf([...bookmarkedAlbums.map((a) => a.date), ...recItems.map((r) => r.album?.date)]);
  const inMonth = (album: ReleaseMasterAlbum | undefined) =>
    listenMonthFilter === "すべて" || album?.date?.substring(0, 7) === listenMonthFilter;

  const filteredSaved = applyReviewFilter(bookmarkedAlbums, listenFilter, myReviewedAlbumNos).filter(inMonth);
  const filteredRecs = recItems.filter(({ album }) => {
    if (!inMonth(album)) return false;
    // Release Master に見つからないレコメンドはレビュー状況を判定できないので「すべて」のときだけ出す
    if (!album) return listenFilter === "all";
    if (listenFilter === "reviewed") return myReviewedAlbumNos.has(album.no);
    if (listenFilter === "unreviewed") return !myReviewedAlbumNos.has(album.no);
    return true;
  });
  const isFiltered = listenFilter !== "all" || listenMonthFilter !== "すべて";

  return (
    <>
      <SegmentTabs
        options={[
          { key: "saved", label: "SAVED" },
          { key: "recommend", label: "RECOMMEND", count: unreviewedRecCount, dot: hasNewForYou },
        ]}
        value={listenMode}
        onChange={onListenModeChange}
      />

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <MonthSelect months={months} value={listenMonthFilter} onChange={onListenMonthFilterChange} />
        {(["all", "unreviewed", "reviewed"] as ReviewFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => onListenFilterChange(f)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
            style={{
              backgroundColor: listenFilter === f ? "rgba(139,92,246,0.3)" : "var(--bg-card)",
              color: listenFilter === f ? "white" : "var(--text-secondary)",
              border: `1px solid ${listenFilter === f ? "var(--accent)" : "var(--border-subtle)"}`,
            }}
          >
            {f === "all" ? "すべて" : f === "reviewed" ? "レビュー済み" : "未レビュー"}
          </button>
        ))}
      </div>

      {listenMode === "saved" ? (
        <SavedList
          albums={filteredSaved}
          isFiltered={isFiltered && bookmarkedAlbums.length > 0}
          spotifyData={spotifyData}
          scoreSummary={scoreSummary}
          myScores={myScores}
          userEmail={userEmail}
          onSelectAlbum={onSelectAlbum}
        />
      ) : (
        <RecommendList
          items={filteredRecs}
          isFiltered={isFiltered && forYou.length > 0}
          myReviewedAlbumNos={myReviewedAlbumNos}
          spotifyData={spotifyData}
          onSelectAlbum={onSelectAlbum}
        />
      )}
    </>
  );
}
