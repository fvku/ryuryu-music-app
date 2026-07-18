"use client";

import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";
import { AuthStatus } from "./utils";

interface AlbumInfoSectionProps {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  spotifyUrl?: string;
  status: AuthStatus;
  mjAdoption: string;
  onToggleMjPicker: () => void;
}

/** カバー画像・タイトル・アーティスト・日付・ジャンル・M/J採用バッジ・Spotifyリンク */
export default function AlbumInfoSection({ album, coverUrl, spotifyUrl, status, mjAdoption, onToggleMjPicker }: AlbumInfoSectionProps) {
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
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>{album.genre}</span>
          )}
          <button
            onClick={() => status === "authenticated" && onToggleMjPicker()}
            className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 transition-opacity"
            style={{
              backgroundColor: mjAdoption && !mjAdoption.includes("不採用") ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
              color: mjAdoption && !mjAdoption.includes("不採用") ? "var(--accent)" : "var(--text-secondary)",
              cursor: status === "authenticated" ? "pointer" : "default",
            }}
          >
            {mjAdoption || "空欄"}
            {status === "authenticated" && <span style={{ fontSize: "10px", opacity: 0.6 }}>✎</span>}
          </button>
        </div>
        {spotifyUrl && (
          <a href={spotifyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-full text-xs font-medium hover:opacity-80 transition-opacity" style={{ backgroundColor: "#1db954", color: "white" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Spotifyで聴く
          </a>
        )}
      </div>
    </div>
  );
}
