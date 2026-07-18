"use client";

import Image from "next/image";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { ScoreSummary } from "@/lib/score-utils";
import { combinedScoreFor, getMyScore, getScoreColor } from "./utils";

interface AlbumRowProps {
  album: ReleaseMasterAlbum;
  reviewedMode?: boolean;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  scoreSummary: ScoreSummary;
  myScores: Score[];
  userEmail: string;
  onSelect: (album: ReleaseMasterAlbum) => void;
}

/** SAVED/REVIEWED共通のアルバム行（カバー・タイトル・スコア） */
export default function AlbumRow({ album, reviewedMode = false, spotifyData, scoreSummary, myScores, userEmail, onSelect }: AlbumRowProps) {
  const spotify = spotifyData[album.no];
  const score = combinedScoreFor(album, scoreSummary);
  const myScore = getMyScore(album, myScores, userEmail);
  return (
    <div
      onClick={() => onSelect(album)}
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
