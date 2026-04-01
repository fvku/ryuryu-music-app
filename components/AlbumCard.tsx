"use client";

import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";

interface AlbumCardProps {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  averageScore?: number | null;
  scoreCount?: number;
  onClick?: () => void;
}

function getScoreColor(score: number): string {
  if (score >= 8) return "#22c55e";
  if (score >= 6) return "#eab308";
  return "#ef4444";
}

function getMjStyle(value: string) {
  const isAdopted = value.includes("採用") && !value.includes("不採用");
  return {
    backgroundColor: isAdopted ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
    color: isAdopted ? "var(--accent)" : "var(--text-secondary)",
  };
}

export default function AlbumCard({ album, coverUrl, averageScore, scoreCount = 0, onClick }: AlbumCardProps) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 p-4 rounded-2xl border transition-all hover:-translate-y-0.5 hover:border-violet-500/40 cursor-pointer active:scale-[0.99]"
      style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
    >
      {/* Cover */}
      <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
        {coverUrl ? (
          <Image src={coverUrl} alt={`${album.title} by ${album.artist}`} fill sizes="56px" className="object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
        <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{album.artist}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
          {album.genre && (
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
              {album.genre}
            </span>
          )}
          {album.mjAdoption && (
            <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={getMjStyle(album.mjAdoption)}>
              {album.mjAdoption}
            </span>
          )}
        </div>
      </div>

      {/* Score */}
      <div className="flex-shrink-0 text-right min-w-[48px]">
        {averageScore != null ? (
          <>
            <p className="font-bold text-base" style={{ color: getScoreColor(averageScore) }}>{averageScore.toFixed(1)}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{scoreCount}件</p>
          </>
        ) : album.legacyScores.length > 0 ? (
          <p className="text-xs" style={{ color: "var(--accent)" }}>レビューあり</p>
        ) : (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>未評価</p>
        )}
      </div>
    </div>
  );
}
