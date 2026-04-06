"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useSession, signIn, signOut } from "next-auth/react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { Bookmark, Recommendation } from "@/lib/sheets";
import { EMAIL_TO_SHORT_NAME, LEGACY_NAME_TO_EMAIL, parseLegacyScoreNum, getDisplayName } from "@/lib/members";
import ReviewModal from "@/components/ReviewModal";
import MjWritingModal from "@/components/MjWritingModal";
import { useNotifications } from "@/contexts/NotificationsContext";

type Tab = "saved" | "foryou" | "reviewed";
type ReviewFilter = "all" | "reviewed" | "unreviewed";

function getScoreColor(score: number) {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#eab308";
  return "#ef4444";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default function MyPage() {
  const { data: session, status } = useSession();
  const { hasNewForYou, markForYouSeen } = useNotifications();
  const [tab, setTab] = useState<Tab>("saved");
  const [savedFilter, setSavedFilter] = useState<ReviewFilter>("unreviewed");
  const [savedMonthFilter, setSavedMonthFilter] = useState<string>("すべて");
  const [forYouFilter, setForYouFilter] = useState<ReviewFilter>("unreviewed");
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
  const [scoreSummary, setScoreSummary] = useState<Record<string, { avg: number; count: number; total: number; members: Set<string>; memberScores: Record<string, number> }>>({});
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<ReleaseMasterAlbum | null>(null);
  const [reviewedSearch, setReviewedSearch] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") { setLoading(false); return; }
    if (status !== "authenticated") return;

    async function init() {
      try {
        const userEmail = session!.user!.email!.toLowerCase();
        const userShortName = EMAIL_TO_SHORT_NAME[userEmail] ?? null;

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

        // M/J 文章の月フィルター初期値：最新月
        const mjAlbumsLocal = albumData.filter((a) => ["採用", "J採用", "掲載", "J掲載"].includes(a.mjAdoption ?? ""));
        const mjMonthsLocal = Array.from(new Set(mjAlbumsLocal.map((a) => a.date?.substring(0, 7)).filter(Boolean))).sort().reverse();
        if (mjMonthsLocal.length > 0) setMjMonthFilter(mjMonthsLocal[0] as string);

        setForYou(forYouData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));

        // 自分がレビュー済みのアルバムNoセット（アプリスコア）
        const myAppScores = allScores.filter((s) =>
          s.memberName.toLowerCase() === userEmail ||
          (userShortName && s.memberName.toLowerCase() === userShortName.toLowerCase())
        );
        setMyScores(myAppScores);
        const reviewedNos = new Set<string>();
        myAppScores.forEach((s) => reviewedNos.add(s.reviewId));
        // legacyScores からも自分分を追加
        albumData.forEach((a) => {
          if (a.legacyScores.some((ls) =>
            ls.name.toLowerCase() === userEmail ||
            (userShortName && ls.name.toLowerCase() === userShortName.toLowerCase())
          )) {
            reviewedNos.add(a.no);
          }
        });
        setMyReviewedAlbumNos(reviewedNos);

        const cached: Record<string, { coverUrl: string; spotifyUrl: string }> = {};
        albumData.forEach((a) => {
          if (a.spotifyUrl || a.coverUrl) cached[a.no] = { coverUrl: a.coverUrl, spotifyUrl: a.spotifyUrl };
        });
        if (Object.keys(cached).length > 0) setSpotifyData(cached);

        const bmKeys = new Set(bmData.map((b) => `${b.albumTitle}::${b.artistName}`));
        const missing = albumData.filter((a) => bmKeys.has(`${a.title}::${a.artist}`) && (!a.spotifyUrl || !a.coverUrl));

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

          Promise.resolve(allScores).then((scores) => {
            const summary: Record<string, { avg: number; count: number; total: number; members: Set<string>; memberScores: Record<string, number> }> = {};
            scores.forEach((s) => {
              if (!summary[s.reviewId]) summary[s.reviewId] = { avg: 0, count: 0, total: 0, members: new Set(), memberScores: {} };
              summary[s.reviewId].members.add(s.memberName.toLowerCase());
              if (s.score !== null) {
                summary[s.reviewId].total += s.score;
                summary[s.reviewId].count += 1;
                summary[s.reviewId].memberScores[s.memberName.toLowerCase()] = s.score;
                summary[s.reviewId].avg = Math.round((summary[s.reviewId].total / summary[s.reviewId].count) * 10) / 10;
              }
            });
            setScoreSummary(summary);
          }),
        ]);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const bookmarkedAlbums = bookmarks
    .map((b) => albums.find((a) => a.title === b.albumTitle && a.artist === b.artistName))
    .filter(Boolean) as ReleaseMasterAlbum[];

  // REVIEWED: 自分がレビューしたアルバム（アプリ or legacy）、リリース日の新しい順
  const reviewedAlbums = albums
    .filter((a) => myReviewedAlbumNos.has(a.no))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  function applyReviewFilter(list: ReleaseMasterAlbum[], filter: ReviewFilter) {
    if (filter === "reviewed") return list.filter((a) => myReviewedAlbumNos.has(a.no));
    if (filter === "unreviewed") return list.filter((a) => !myReviewedAlbumNos.has(a.no));
    return list;
  }

  function getCombinedScore(album: ReleaseMasterAlbum) {
    const app = scoreSummary[album.no];
    const legacyCoveredIds = new Set<string>();
    let legacyTotal = 0, legacyCount = 0;
    for (const ls of album.legacyScores) {
      const n = parseLegacyScoreNum(ls.value);
      if (n !== null && n >= 0 && n <= 10) {
        legacyTotal += n; legacyCount++;
        const email = LEGACY_NAME_TO_EMAIL[ls.name.toLowerCase()];
        if (email) legacyCoveredIds.add(email);
        legacyCoveredIds.add(ls.name.toLowerCase());
      }
    }
    let appOnlyTotal = 0, appOnlyCount = 0;
    for (const [member, score] of Object.entries(app?.memberScores ?? {})) {
      if (!legacyCoveredIds.has(member)) { appOnlyTotal += score; appOnlyCount++; }
    }
    const total = legacyTotal + appOnlyTotal;
    const count = legacyCount + appOnlyCount;
    if (count === 0) return null;
    return { avg: Math.round((total / count) * 10) / 10, count };
  }

  function getMyScore(album: ReleaseMasterAlbum): number | null {
    const appScore = myScores.find((s) => s.reviewId === album.no);
    if (appScore) return appScore.score;
    const userEmail = session?.user?.email?.toLowerCase() ?? "";
    const userShortName = EMAIL_TO_SHORT_NAME[userEmail] ?? null;
    const legacy = album.legacyScores.find((ls) =>
      ls.name.toLowerCase() === userEmail ||
      (userShortName && ls.name.toLowerCase() === userShortName.toLowerCase())
    );
    if (legacy) return parseLegacyScoreNum(legacy.value);
    return null;
  }

  const savedMonths = ["すべて", ...Array.from(new Set(bookmarkedAlbums.map((a) => a.date?.substring(0, 7)).filter(Boolean))).sort().reverse()];
  const filteredSaved = applyReviewFilter(bookmarkedAlbums, savedFilter).filter((a) =>
    savedMonthFilter === "すべて" || a.date?.substring(0, 7) === savedMonthFilter
  );
  const filteredForYou = forYou.filter((rec) => {
    const album = albums.find((a) => a.title === rec.albumTitle && a.artist === rec.artistName)
      ?? albums.find((a) => a.no === rec.albumNo);
    if (!album) return forYouFilter === "all";
    if (forYouFilter === "reviewed") return myReviewedAlbumNos.has(album.no);
    if (forYouFilter === "unreviewed") return !myReviewedAlbumNos.has(album.no);
    return true;
  });

  function handleTabChange(key: Tab) {
    setTab(key);
    if (key === "foryou") markForYouSeen();
  }

  // M/J 文章モード用
  const mjAlbums = albums.filter((a) => ["採用", "J採用", "掲載", "J掲載"].includes(a.mjAdoption ?? ""));
  const mjMonths = ["すべて", ...Array.from(new Set(mjAlbums.map((a) => a.date?.substring(0, 7)).filter(Boolean))).sort().reverse()];
  const filteredMjAlbums = mjAlbums
    .filter((a) => mjMonthFilter === "すべて" || a.date?.substring(0, 7) === mjMonthFilter)
    .filter((a) => {
      if (mjTypeFilter === "monthly") return a.mjAdoption === "採用" || a.mjAdoption === "掲載";
      if (mjTypeFilter === "japan") return a.mjAdoption === "J採用" || a.mjAdoption === "J掲載";
      return true;
    });

  // ASSIGN列（R=17）の値から担当者名を解析
  function getAssignInfo(album: ReleaseMasterAlbum): { isMe: boolean; name: string } | null {
    const a = album.mjAssign?.trim();
    if (!a) return null;
    const userEmail = session?.user?.email?.toLowerCase() ?? "";
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

  function handleMjSaved(updated: Partial<ReleaseMasterAlbum>) {
    if (!mjWritingAlbum) return;
    setAlbums((prev) => prev.map((a) => (a.no === mjWritingAlbum.no ? { ...a, ...updated } : a)));
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "saved", label: "SAVED", count: bookmarkedAlbums.length },
    { key: "foryou", label: "FOR YOU", count: forYou.length },
    { key: "reviewed", label: "REVIEWED", count: reviewedAlbums.length },
  ];

  function ReviewFilterButtons({ value, onChange }: { value: ReviewFilter; onChange: (v: ReviewFilter) => void }) {
    return (
      <div className="flex gap-2 mb-4">
        {(["all", "unreviewed", "reviewed"] as ReviewFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => onChange(f)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor: value === f ? "rgba(139,92,246,0.3)" : "var(--bg-card)",
              color: value === f ? "white" : "var(--text-secondary)",
              border: `1px solid ${value === f ? "var(--accent)" : "var(--border-subtle)"}`,
            }}
          >
            {f === "all" ? "すべて" : f === "reviewed" ? "レビュー済み" : "未レビュー"}
          </button>
        ))}
      </div>
    );
  }

  function AlbumRow({ album, reviewedMode = false }: { album: ReleaseMasterAlbum; reviewedMode?: boolean }) {
    const spotify = spotifyData[album.no];
    const score = getCombinedScore(album);
    const myScore = getMyScore(album);
    return (
      <div
        onClick={() => setSelectedAlbum(album)}
        className="flex items-center gap-4 p-4 rounded-2xl border transition-all hover:-translate-y-0.5 hover:border-violet-500/40 cursor-pointer active:scale-[0.99]"
        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
      >
        <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
          {spotify?.coverUrl ? (
            <Image src={spotify.coverUrl} alt={album.title} fill sizes="56px" className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
          <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{album.artist}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
            {album.genre && (
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>{album.genre}</span>
            )}
          </div>
        </div>
        {reviewedMode ? (
          <div className="flex-shrink-0 text-right min-w-[52px]">
            {score != null ? (
              <p className="font-bold text-lg leading-tight" style={{ color: getScoreColor(score.avg) }}>{score.avg.toFixed(1)}</p>
            ) : (
              <p className="font-bold text-lg leading-tight" style={{ color: "var(--text-secondary)" }}>—</p>
            )}
            <p className="text-[10px] leading-tight mt-0.5" style={{ color: "var(--text-secondary)" }}>
              MY{" "}
              <span style={{ color: myScore !== null ? getScoreColor(myScore) : "var(--text-secondary)" }}>
                {myScore !== null ? (myScore % 1 === 0 ? myScore.toFixed(1) : myScore) : "—"}
              </span>
            </p>
          </div>
        ) : (
          <div className="flex-shrink-0 text-right min-w-[48px]">
            {myScore !== null ? (
              <p className="font-bold text-base" style={{ color: getScoreColor(myScore) }}>{myScore % 1 === 0 ? myScore.toFixed(1) : myScore}</p>
            ) : score != null ? (
              <p className="font-bold text-base" style={{ color: getScoreColor(score.avg) }}>{score.avg.toFixed(1)}</p>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>未評価</p>
            )}
            {score && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{score.count}件</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Profile */}
      <div className="rounded-xl px-4 py-3 border mb-5 flex items-center gap-3" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        {session.user?.image && (
          <Image src={session.user.image} alt={session.user.name ?? ""} width={36} height={36} className="rounded-full flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{session.user?.name}</p>
          <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{session.user?.email}</p>
        </div>
        <button
          onClick={() => signOut()}
          className="text-xs px-2.5 py-1 rounded-lg border flex-shrink-0"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          ログアウト
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-5" style={{ borderColor: "var(--border-subtle)" }}>
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className="flex-1 py-3 text-xs font-bold tracking-wide transition-colors"
            style={{
              color: tab === key ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            <span className="relative inline-flex items-center gap-1">
              {label}
              {key === "foryou" && hasNewForYou && (
                <span className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-red-500" />
              )}
              {count > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tab === key ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.08)" }}>
                  {count}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* SAVED */}
      {tab === "saved" && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <select
              value={savedMonthFilter}
              onChange={(e) => setSavedMonthFilter(e.target.value)}
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
                onClick={() => setSavedFilter(f)}
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
              {filteredSaved.map((album) => <AlbumRow key={album.no} album={album} />)}
            </div>
          )}
        </>
      )}

      {/* FOR YOU */}
      {tab === "foryou" && (
        <>
          {/* トップレベル: レコメンド / M/J 文章 — 全幅タブ */}
          <div className="flex rounded-xl overflow-hidden mb-5 border" style={{ borderColor: "var(--border-subtle)" }}>
            {(["recommend", "mj"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setForYouMode(mode)}
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

          {/* レコメンドモード */}
          {forYouMode === "recommend" && (
            <>
              <ReviewFilterButtons value={forYouFilter} onChange={setForYouFilter} />
              {filteredForYou.length === 0 ? (
                <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
                  <p className="text-4xl mb-4">✉️</p>
                  <p style={{ color: "var(--text-secondary)" }}>
                    {forYouFilter === "all" ? "まだレコメンドが届いていません" : "該当するレコメンドはありません"}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {filteredForYou.map((rec) => {
                    const album = albums.find((a) => a.title === rec.albumTitle && a.artist === rec.artistName)
                      ?? albums.find((a) => a.no === rec.albumNo);
                    const coverUrl = album ? spotifyData[album.no]?.coverUrl || rec.coverUrl : rec.coverUrl;
                    const isReviewed = album ? myReviewedAlbumNos.has(album.no) : false;
                    return (
                      <div
                        key={rec.id}
                        onClick={() => album && setSelectedAlbum(album)}
                        className="rounded-2xl p-4 border transition-all hover:-translate-y-0.5 hover:border-violet-500/40 cursor-pointer active:scale-[0.99]"
                        style={{ backgroundColor: "var(--bg-card)", borderColor: "rgba(139,92,246,0.3)" }}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                            {getDisplayName(rec.recommenderId).charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{getDisplayName(rec.recommenderId)}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>レコメンド</span>
                          {isReviewed && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" }}>レビュー済み</span>
                          )}
                          <span className="text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>{formatDate(rec.createdAt)}</span>
                        </div>
                        <div className="flex gap-3 items-center">
                          <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                            {coverUrl ? (
                              <Image src={coverUrl} alt={rec.albumTitle} fill sizes="48px" className="object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                                  <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{rec.albumTitle}</p>
                            <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{rec.artistName}</p>
                          </div>
                        </div>
                        {rec.message && (
                          <p className="mt-3 text-sm leading-relaxed pl-1" style={{ color: "var(--text-secondary)" }}>
                            &ldquo;{rec.message}&rdquo;
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* M/J 文章モード */}
          {forYouMode === "mj" && (
            <>
              {/* 月フィルター + MONTHLY/JAPAN タブ */}
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <select
                  value={mjMonthFilter}
                  onChange={(e) => setMjMonthFilter(e.target.value)}
                  className="px-3 py-1 rounded-xl border text-xs font-medium focus:outline-none flex-shrink-0"
                  style={{
                    backgroundColor: "var(--bg-card)",
                    borderColor: mjMonthFilter !== "すべて" ? "var(--accent)" : "var(--border-subtle)",
                    color: mjMonthFilter !== "すべて" ? "white" : "var(--text-secondary)",
                  }}
                >
                  {mjMonths.map((m) => (
                    <option key={m} value={m}>
                      {m === "すべて" ? "すべて" : `${m.split("/")[0]}年${parseInt(m.split("/")[1])}月`}
                    </option>
                  ))}
                </select>
                {(["all", "monthly", "japan"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setMjTypeFilter(f)}
                    className="px-3 py-1 rounded-lg border text-xs font-bold transition-colors flex-shrink-0"
                    style={{
                      backgroundColor: mjTypeFilter === f ? "rgba(139,92,246,0.2)" : "transparent",
                      color: mjTypeFilter === f ? "white" : "var(--text-secondary)",
                      borderColor: mjTypeFilter === f ? "var(--accent)" : "var(--border-subtle)",
                    }}
                  >
                    {f === "all" ? "すべて" : f === "monthly" ? "MONTHLY" : "JAPAN"}
                  </button>
                ))}
              </div>

              {filteredMjAlbums.length === 0 ? (
                <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
                  <p className="text-4xl mb-4">📝</p>
                  <p style={{ color: "var(--text-secondary)" }}>該当するアルバムはありません</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredMjAlbums.map((album) => {
                    const cover = spotifyData[album.no]?.coverUrl || album.coverUrl;
                    const assignInfo = getAssignInfo(album);
                    const isPosted = album.mjAdoption === "掲載" || album.mjAdoption === "J掲載";
                    const hasText = isPosted
                      ? !!(album.mjTrack || album.mjTrackNo)
                      : album.mjText && album.mjText.trim().length >= 80;
                    return (
                      <div
                        key={album.no}
                        onClick={() => setMjWritingAlbum(album)}
                        className="flex items-center gap-4 p-4 rounded-2xl border transition-all hover:-translate-y-0.5 hover:border-violet-500/40 cursor-pointer active:scale-[0.99]"
                        style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
                      >
                        <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                          {cover ? (
                            <Image src={cover} alt={album.title} fill sizes="56px" className="object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
                          <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{album.artist}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(139,92,246,0.12)", color: "var(--accent)" }}>
                              {(album.mjAdoption === "採用" || album.mjAdoption === "掲載") ? "MONTHLY" : "JAPAN"}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{
                              backgroundColor: (album.mjAdoption === "採用" || album.mjAdoption === "J採用") ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)",
                              color: (album.mjAdoption === "採用" || album.mjAdoption === "J採用") ? "#22c55e" : "#eab308",
                            }}>
                              {(album.mjAdoption === "採用" || album.mjAdoption === "J採用") ? "採用" : "掲載"}
                            </span>
                          </div>
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-1">
                          {assignInfo === null ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(107,114,128,0.15)", color: "#6b7280" }}>
                              unassigned
                            </span>
                          ) : assignInfo.isMe ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: "rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                              ASSIGNED
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(139,92,246,0.15)", color: "var(--accent)" }}>
                              {assignInfo.name}
                            </span>
                          )}
                          {hasText && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
                              済み
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* REVIEWED */}
      {tab === "reviewed" && (
        <>
          {reviewedAlbums.length > 0 && (
            <div className="mb-4 relative">
              <input
                type="text"
                value={reviewedSearch}
                onChange={(e) => setReviewedSearch(e.target.value)}
                placeholder="アーティスト名・アルバム名で検索..."
                className="w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:border-violet-500/50 pr-10"
                style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
              />
              {reviewedSearch && (
                <button
                  onClick={() => setReviewedSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-xs"
                  style={{ backgroundColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
          {(() => {
            const q = reviewedSearch.trim().toLowerCase();
            const filtered = q
              ? reviewedAlbums.filter((a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
              : reviewedAlbums;
            if (filtered.length === 0) {
              return (
                <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
                  <p className="text-4xl mb-4">⭐</p>
                  <p style={{ color: "var(--text-secondary)" }}>{reviewedAlbums.length === 0 ? "まだレビューがありません" : "該当するアルバムはありません"}</p>
                </div>
              );
            }
            return (
              <div className="flex flex-col gap-2">
                {filtered.map((album) => <AlbumRow key={album.no} album={album} reviewedMode />)}
              </div>
            );
          })()}
        </>
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
