"use client";

import { signIn } from "next-auth/react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { isSameAlbum } from "@/lib/score-utils";
import ReviewModal from "@/components/ReviewModal";
import MjWritingModal from "@/components/MjWritingModal";
import { Tab, useMyPageData } from "@/hooks/useMyPageData";
import ProfileHeader from "@/components/mypage/ProfileHeader";
import TabBar from "@/components/mypage/TabBar";
import SavedTab from "@/components/mypage/SavedTab";
import ForYouTab from "@/components/mypage/ForYouTab";
import ReviewedTab from "@/components/mypage/ReviewedTab";
import { getAssignInfo, getMjAlbums, hasMjText } from "@/components/mypage/utils";

export default function MyPage() {
  const {
    session, status, loading, hasNewForYou,
    tab, handleTabChange,
    savedFilter, setSavedFilter, savedMonthFilter, setSavedMonthFilter,
    forYouFilter, setForYouFilter, forYouMonthFilter, setForYouMonthFilter,
    forYouMode, setForYouMode,
    mjMonthFilter, setMjMonthFilter, mjTypeFilter, setMjTypeFilter,
    mjWritingAlbum, setMjWritingAlbum, handleMjSaved,
    bookmarks, forYou, myReviewedAlbumNos, myScores, albums,
    spotifyData, scoreSummary,
    selectedAlbum, setSelectedAlbum,
    reviewedSearch, setReviewedSearch,
  } = useMyPageData();

  if (status === "loading" || loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-full border-4 animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
        <p style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-card)" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-secondary)" }}>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="text-center">
          <p className="font-bold text-lg mb-1" style={{ color: "var(--text-primary)" }}>ログインが必要です</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>マイページを利用するにはGoogleログインしてください</p>
        </div>
        <button
          onClick={() => signIn("google")}
          className="inline-flex items-center gap-3 px-6 py-3 rounded-xl font-medium text-sm hover:opacity-90"
          style={{ backgroundColor: "white", color: "#1f1f1f" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Googleでログイン
        </button>
      </div>
    );
  }

  const userEmail = session.user?.email?.toLowerCase() ?? "";

  const bookmarkedAlbums = bookmarks
    .map((b) => albums.find((a) => isSameAlbum(a, b)))
    .filter(Boolean) as ReleaseMasterAlbum[];

  // REVIEWED: 自分がレビューしたアルバム（アプリ or legacy）、リリース日の新しい順
  const reviewedAlbums = albums
    .filter((a) => myReviewedAlbumNos.has(a.no))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const mjAlbums = getMjAlbums(albums);

  // FOR YOU バッジ数: 未確認レコメンド + 自分にASSIGNされた未済みM/J
  const unreviewedRecCount = forYou.filter((rec) => {
    const album = albums.find((a) => isSameAlbum(a, rec));
    return !album || !myReviewedAlbumNos.has(album.no);
  }).length;
  const mjPendingCount = mjAlbums.filter((album) => {
    const assignInfo = getAssignInfo(album, userEmail);
    if (!assignInfo?.isMe) return false;
    return !hasMjText(album);
  }).length;
  const forYouBadgeCount = unreviewedRecCount + mjPendingCount;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "saved", label: "SAVED", count: 0 },
    { key: "foryou", label: "FOR YOU", count: forYouBadgeCount },
    { key: "reviewed", label: "REVIEWED", count: 0 },
  ];

  return (
    <div>
      <ProfileHeader session={session} />
      <TabBar tabs={tabs} tab={tab} hasNewForYou={hasNewForYou} onTabChange={handleTabChange} />

      {tab === "saved" && (
        <SavedTab
          bookmarkedAlbums={bookmarkedAlbums}
          myReviewedAlbumNos={myReviewedAlbumNos}
          savedFilter={savedFilter}
          onSavedFilterChange={setSavedFilter}
          savedMonthFilter={savedMonthFilter}
          onSavedMonthFilterChange={setSavedMonthFilter}
          spotifyData={spotifyData}
          scoreSummary={scoreSummary}
          myScores={myScores}
          userEmail={userEmail}
          onSelectAlbum={setSelectedAlbum}
        />
      )}

      {tab === "foryou" && (
        <ForYouTab
          forYou={forYou}
          albums={albums}
          mjAlbums={mjAlbums}
          myReviewedAlbumNos={myReviewedAlbumNos}
          spotifyData={spotifyData}
          forYouMode={forYouMode}
          onForYouModeChange={setForYouMode}
          forYouFilter={forYouFilter}
          onForYouFilterChange={setForYouFilter}
          forYouMonthFilter={forYouMonthFilter}
          onForYouMonthFilterChange={setForYouMonthFilter}
          mjMonthFilter={mjMonthFilter}
          onMjMonthFilterChange={setMjMonthFilter}
          mjTypeFilter={mjTypeFilter}
          onMjTypeFilterChange={setMjTypeFilter}
          userEmail={userEmail}
          onSelectAlbum={setSelectedAlbum}
          onSelectMjAlbum={setMjWritingAlbum}
        />
      )}

      {tab === "reviewed" && (
        <ReviewedTab
          reviewedAlbums={reviewedAlbums}
          reviewedSearch={reviewedSearch}
          onReviewedSearchChange={setReviewedSearch}
          spotifyData={spotifyData}
          scoreSummary={scoreSummary}
          myScores={myScores}
          userEmail={userEmail}
          onSelectAlbum={setSelectedAlbum}
        />
      )}

      {selectedAlbum && (
        <ReviewModal
          album={selectedAlbum}
          coverUrl={spotifyData[selectedAlbum.no]?.coverUrl}
          spotifyUrl={spotifyData[selectedAlbum.no]?.spotifyUrl}
          onClose={() => setSelectedAlbum(null)}
        />
      )}

      {mjWritingAlbum && (
        <MjWritingModal
          album={mjWritingAlbum}
          coverUrl={spotifyData[mjWritingAlbum.no]?.coverUrl || mjWritingAlbum.coverUrl}
          spotifyUrl={spotifyData[mjWritingAlbum.no]?.spotifyUrl || mjWritingAlbum.spotifyUrl}
          onClose={() => setMjWritingAlbum(null)}
          onSaved={handleMjSaved}
        />
      )}
    </div>
  );
}
