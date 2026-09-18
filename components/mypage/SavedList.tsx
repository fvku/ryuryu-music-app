"use client";

import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { ScoreSummary } from "@/lib/score-utils";
import AlbumRow from "./AlbumRow";

interface SavedListProps {
  /** LISTEN の共通フィルター適用済みの一覧 */
  albums: ReleaseMasterAlbum[];
  isFiltered: boolean;
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  scoreSummary: ScoreSummary;
  myScores: Score[];
  userEmail: string;
  onSelectAlbum: (album: ReleaseMasterAlbum) => void;
}

/** LISTEN > SAVED: 保存済みアルバムの一覧 */
export default function SavedList({ albums, isFiltered, spotifyData, scoreSummary, myScores, userEmail, onSelectAlbum }: SavedListProps) {
  if (albums.length === 0) {
    return (
      <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        <p className="text-4xl mb-4">🔖</p>
        <p style={{ color: "var(--text-secondary)" }}>
          {isFiltered ? "該当するアルバムはありません" : "保存されたアルバムはありません"}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {albums.map((album) => (
        <AlbumRow key={album.no} album={album} spotifyData={spotifyData} scoreSummary={scoreSummary} myScores={myScores} userEmail={userEmail} onSelect={onSelectAlbum} />
      ))}
    </div>
  );
}
