"use client";

import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";
import { Recommendation } from "@/lib/sheets";
import { getDisplayName } from "@/lib/members";
import { formatDate } from "./utils";

interface RecommendListProps {
  /** LISTEN の共通フィルター適用済みのレコメンド（album はRelease Masterで見つからなければ undefined） */
  items: { rec: Recommendation; album: ReleaseMasterAlbum | undefined }[];
  isFiltered: boolean;
  myReviewedAlbumNos: Set<string>;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  onSelectAlbum: (album: ReleaseMasterAlbum) => void;
}

/** LISTEN > RECOMMEND: 自分宛てのレコメンド一覧 */
export default function RecommendList({ items, isFiltered, myReviewedAlbumNos, spotifyData, onSelectAlbum }: RecommendListProps) {
  return (
    <>
      {items.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">✉️</p>
          <p style={{ color: "var(--text-secondary)" }}>
            {isFiltered ? "該当するレコメンドはありません" : "まだレコメンドが届いていません"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map(({ rec, album }) => {
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
