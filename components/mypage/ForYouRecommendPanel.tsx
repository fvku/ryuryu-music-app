"use client";

import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";
import { Recommendation } from "@/lib/sheets";
import { getDisplayName } from "@/lib/members";
import { isSameAlbum } from "@/lib/score-utils";
import { formatDate, ReviewFilter } from "./utils";

interface ForYouRecommendPanelProps {
  forYou: Recommendation[];
  albums: ReleaseMasterAlbum[];
  myReviewedAlbumNos: Set<string>;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  forYouFilter: ReviewFilter;
  onForYouFilterChange: (f: ReviewFilter) => void;
  forYouMonthFilter: string;
  onForYouMonthFilterChange: (m: string) => void;
  onSelectAlbum: (album: ReleaseMasterAlbum) => void;
}

/** FOR YOU > レコメンドモード: 月/レビュー状況フィルターとレコメンド一覧 */
export default function ForYouRecommendPanel({
  forYou, albums, myReviewedAlbumNos, spotifyData,
  forYouFilter, onForYouFilterChange, forYouMonthFilter, onForYouMonthFilterChange, onSelectAlbum,
}: ForYouRecommendPanelProps) {
  const forYouMonths = ["すべて", ...Array.from(new Set(
    forYou.map((rec) => albums.find((a) => isSameAlbum(a, rec))?.date?.substring(0, 7)).filter(Boolean)
  )).sort().reverse()];

  const filteredForYou = forYou.filter((rec) => {
    const album = albums.find((a) => isSameAlbum(a, rec));
    if (forYouMonthFilter !== "すべて" && album?.date?.substring(0, 7) !== forYouMonthFilter) return false;
    if (!album) return forYouFilter === "all";
    if (forYouFilter === "reviewed") return myReviewedAlbumNos.has(album.no);
    if (forYouFilter === "unreviewed") return !myReviewedAlbumNos.has(album.no);
    return true;
  });

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <select
          value={forYouMonthFilter}
          onChange={(e) => onForYouMonthFilterChange(e.target.value)}
          className="px-3 py-1 rounded-xl border text-xs font-medium focus:outline-none flex-shrink-0"
          style={{ backgroundColor: "var(--bg-card)", borderColor: forYouMonthFilter !== "すべて" ? "var(--accent)" : "var(--border-subtle)", color: forYouMonthFilter !== "すべて" ? "white" : "var(--text-secondary)" }}
        >
          {forYouMonths.map((m) => (
            <option key={m} value={m}>{m === "すべて" ? "すべて" : `${m!.split("/")[0]}年${parseInt(m!.split("/")[1])}月`}</option>
          ))}
        </select>
        {(["all", "unreviewed", "reviewed"] as ReviewFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => onForYouFilterChange(f)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors flex-shrink-0"
            style={{
              backgroundColor: forYouFilter === f ? "rgba(139,92,246,0.3)" : "var(--bg-card)",
              color: forYouFilter === f ? "white" : "var(--text-secondary)",
              border: `1px solid ${forYouFilter === f ? "var(--accent)" : "var(--border-subtle)"}`,
            }}
          >
            {f === "all" ? "すべて" : f === "reviewed" ? "レビュー済み" : "未レビュー"}
          </button>
        ))}
      </div>
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
            const album = albums.find((a) => isSameAlbum(a, rec));
            const coverUrl = album ? spotifyData[album.no]?.coverUrl || rec.coverUrl : rec.coverUrl;
            const isReviewed = album ? myReviewedAlbumNos.has(album.no) : false;
            return (
              <div
                key={rec.id}
                onClick={() => album && onSelectAlbum(album)}
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
  );
}
