"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { Bookmark, Recommendation } from "@/lib/sheets";
import { buildScoreSummary, getMyReviewedAlbumNos, isSameAlbum, namesForUser, ScoreSummary } from "@/lib/score-utils";
import { useNotifications } from "@/contexts/NotificationsContext";
import { ReviewFilter } from "@/components/mypage/utils";

export type Tab = "saved" | "foryou" | "reviewed";
export type { ReviewFilter };

/**
 * マイページの状態・データ取得・localStorage永続化（`ryuryu_mypage_filters`）を一元管理。
 * タブ/フィルターの復元順序はイニシャライズ処理内でしか成立しないため分割しない。
 */
export function useMyPageData() {
  const { data: session, status } = useSession();
  const { hasNewForYou, markForYouSeen } = useNotifications();
  const [tab, setTab] = useState<Tab>("saved");
  const [savedFilter, setSavedFilter] = useState<ReviewFilter>("unreviewed");
  const [savedMonthFilter, setSavedMonthFilter] = useState<string>("すべて");
  const [forYouFilter, setForYouFilter] = useState<ReviewFilter>("unreviewed");
  const [forYouMonthFilter, setForYouMonthFilter] = useState<string>("すべて");
  const [forYouMode, setForYouMode] = useState<"recommend" | "mj">("recommend");
  const [mjMonthFilter, setMjMonthFilter] = useState<string>("すべて");
  const [mjTypeFilter, setMjTypeFilter] = useState<"all" | "monthly" | "japan">("all");
  const [mjWritingAlbum, setMjWritingAlbum] = useState<ReleaseMasterAlbum | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [forYou, setForYou] = useState<Recommendation[]>([]);
  const [myReviewedAlbumNos, setMyReviewedAlbumNos] = useState<Set<string>>(new Set());
  const [myScores, setMyScores] = useState<Score[]>([]);
  const [albums, setAlbums] = useState<ReleaseMasterAlbum[]>([]);
  const [spotifyData, setSpotifyData] = useState<Record<string, { coverUrl: string; spotifyUrl: string }>>({});
  const [scoreSummary, setScoreSummary] = useState<ScoreSummary>({});
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<ReleaseMasterAlbum | null>(null);
  const [reviewedSearch, setReviewedSearch] = useState("");
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  // 初期化完了後のみ保存
  useEffect(() => {
    if (!filtersInitialized) return;
    try {
      localStorage.setItem("ryuryu_mypage_filters", JSON.stringify({ tab, savedFilter, savedMonthFilter, forYouFilter, forYouMonthFilter, forYouMode, mjTypeFilter, mjMonthFilter }));
    } catch {}
  }, [tab, savedFilter, savedMonthFilter, forYouFilter, forYouMonthFilter, forYouMode, mjTypeFilter, mjMonthFilter, filtersInitialized]);

  useEffect(() => {
    if (status !== "authenticated") return;

    async function init() {
      try {
        const userEmail = session!.user!.email!.toLowerCase();

        const [bmRes, albumRes, forYouRes, scoresRes] = await Promise.all([
          fetch("/api/bookmarks"),
          fetch("/api/release-master"),
          fetch("/api/recommendations?forUser=me"),
          fetch("/api/scores"),
        ]);
        const [bmData, albumData, forYouData, allScores]: [Bookmark[], ReleaseMasterAlbum[], Recommendation[], Score[]] = await Promise.all([
          bmRes.ok ? bmRes.json() : [],
          albumRes.ok ? albumRes.json() : [],
          forYouRes.ok ? forYouRes.json() : [],
          scoresRes.ok ? scoresRes.json() : [],
        ]);

        setBookmarks(bmData);
        setAlbums(albumData);

        // localStorageから保存済みフィルターを復元
        const savedF = (() => { try { return JSON.parse(localStorage.getItem("ryuryu_mypage_filters") || "{}"); } catch { return {}; } })();
        if (savedF.tab) setTab(savedF.tab);
        if (savedF.savedFilter) setSavedFilter(savedF.savedFilter);
        if (savedF.savedMonthFilter) setSavedMonthFilter(savedF.savedMonthFilter);
        if (savedF.forYouFilter) setForYouFilter(savedF.forYouFilter);
        if (savedF.forYouMonthFilter) setForYouMonthFilter(savedF.forYouMonthFilter);
        if (savedF.forYouMode) setForYouMode(savedF.forYouMode);
        if (savedF.mjTypeFilter) setMjTypeFilter(savedF.mjTypeFilter);

        // M/J 文章の月フィルター初期値：保存済み優先、なければ最新月
        const mjAlbumsLocal = albumData.filter((a) => ["採用", "J採用", "掲載", "J掲載"].includes(a.mjAdoption ?? ""));
        const mjMonthsLocal = Array.from(new Set(mjAlbumsLocal.map((a) => a.date?.substring(0, 7)).filter(Boolean))).sort().reverse();
        if (savedF.mjMonthFilter) {
          setMjMonthFilter(savedF.mjMonthFilter);
        } else if (mjMonthsLocal.length > 0) {
          setMjMonthFilter(mjMonthsLocal[0] as string);
        }
        setFiltersInitialized(true);

        setForYou(forYouData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));

        // 自分のアプリスコア一覧とレビュー済みアルバムNoセット
        const myNames = namesForUser(userEmail);
        setMyScores(allScores.filter((s) => myNames.has(s.memberName.trim().toLowerCase())));
        setMyReviewedAlbumNos(getMyReviewedAlbumNos(albumData, allScores, userEmail));

        const cached: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
        albumData.forEach((a) => {
          if (a.spotifyUrl || a.coverUrl) cached[a.no] = { coverUrl: a.coverUrl, spotifyUrl: a.spotifyUrl };
        });
        if (Object.keys(cached).length > 0) setSpotifyData(cached);

        const missing = albumData.filter((a) => bmData.some((b) => isSameAlbum(a, b)) && (!a.spotifyUrl || !a.coverUrl));

        Promise.all([
          missing.length > 0
            ? fetch("/api/spotify/covers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ albums: missing.map((a) => ({ no: a.no, title: a.title, artist: a.artist })) }),
              }).then((r) => r.ok ? r.json() : {}).then((newData: Record<string, { coverUrl: string; spotifyUrl: string }>) => {
                setSpotifyData((prev) => ({ ...prev, ...newData }));
              })
            : Promise.resolve(),

        ]);
        setScoreSummary(buildScoreSummary(allScores));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTabChange(key: Tab) {
    setTab(key);
    if (key === "foryou") markForYouSeen();
  }

  function handleMjSaved(updated: Partial<ReleaseMasterAlbum>) {
    if (!mjWritingAlbum) return;
    setAlbums((prev) => prev.map((a) => (a.no === mjWritingAlbum.no ? { ...a, ...updated } : a)));
  }

  return {
    // 未認証時はデータ取得が走らないため、ローディング表示は不要
    session, status, loading: status === "unauthenticated" ? false : loading, hasNewForYou,
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
  };
}
