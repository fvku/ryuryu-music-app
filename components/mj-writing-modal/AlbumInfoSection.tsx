"use client";

import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";
import { getMjStyle } from "./utils";
import ListenLinkButton from "@/components/ListenLinkButton";

interface AlbumInfoSectionProps {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  effectiveSpotifyUrl?: string;
  currentMjAdoption: string;
  onToggleMjPicker: () => void;
}

/** カバー画像・タイトル・アーティスト・日付・ジャンル・M/J採用バッジ・Spotifyリンク */
export default function AlbumInfoSection({ album, coverUrl, effectiveSpotifyUrl, currentMjAdoption, onToggleMjPicker }: AlbumInfoSectionProps) {
  return (
    <div className="flex gap-4 items-start">
      <div className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
        {coverUrl ? (
          <Image src={coverUrl} alt={album.title} fill sizes="80px" className="object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-base truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
        <p className="text-sm mt-0.5 truncate" style={{ color: "var(--accent)" }}>{album.artist}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
          {album.genre && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
              {album.genre}
            </span>
          )}
          <button
            type="button"
            onClick={onToggleMjPicker}
            className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-opacity hover:opacity-80"
            style={getMjStyle(currentMjAdoption)}
          >
            {currentMjAdoption || "空欄"}
            <span style={{ fontSize: "10px", opacity: 0.6 }}>✎</span>
          </button>
        </div>
        <ListenLinkButton url={effectiveSpotifyUrl} />
      </div>
    </div>
  );
}
