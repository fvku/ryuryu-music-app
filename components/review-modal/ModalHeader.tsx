"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { AuthStatus } from "./utils";

interface ModalHeaderProps {
  album: Pick<ReleaseMasterAlbum, "title" | "artist">;
  status: AuthStatus;
  bookmarked: boolean;
  bookmarkLoading: boolean;
  onToggleBookmark: () => void;
  onClose: () => void;
  touchHandlers: {
    onTouchStart: (e: TouchEvent) => void;
    onTouchMove: (e: TouchEvent) => void;
    onTouchEnd: () => void;
  };
}

/** モーダル上部のスティッキーヘッダー（ドラッグバー・ブックマーク・シェア・閉じる） */
export default function ModalHeader({ album, status, bookmarked, bookmarkLoading, onToggleBookmark, onClose, touchHandlers }: ModalHeaderProps) {
  return (
    <div
      className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b relative"
      style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)", touchAction: "none" }}
      {...touchHandlers}
    >
      {/* Drag indicator */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
      {/* Left: bookmark */}
      {status === "authenticated" ? (
        <button
          onClick={onToggleBookmark}
          disabled={bookmarkLoading}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 disabled:opacity-50"
          style={{ color: bookmarked ? "#eab308" : "var(--text-secondary)" }}
          title={bookmarked ? "保存済み" : "気になるリストに保存"}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      ) : (
        <div className="w-10 h-10" />
      )}
      {/* Right: share + close */}
      <div className="flex items-center gap-1">
        <ShareMenu album={album} />
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 text-lg font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ShareMenu({ album }: { album: Pick<ReleaseMasterAlbum, "title" | "artist"> }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [shareOpen]);

  function handleCopy() {
    navigator.clipboard.writeText(`${album.artist} / ${album.title}`);
    setCopyDone(true);
    setTimeout(() => { setCopyDone(false); setShareOpen(false); }, 1500);
  }

  function handleAoty() {
    const q = encodeURIComponent(`${album.artist} ${album.title}`);
    window.open(`https://www.albumoftheyear.org/search/?q=${q}`, "_blank", "noopener");
    setShareOpen(false);
  }

  return (
    <div ref={shareRef} className="relative">
      <button
        onClick={() => setShareOpen((v) => !v)}
        className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
        style={{ color: "var(--text-secondary)" }}
        title="シェア"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>
      {shareOpen && (
        <div
          className="absolute right-0 top-12 rounded-2xl border overflow-hidden z-50"
          style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)", minWidth: "220px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
        >
          <button
            onClick={handleCopy}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors hover:bg-white/8"
            style={{ color: copyDone ? "#22c55e" : "var(--text-primary)" }}
          >
            {copyDone ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            )}
            {copyDone ? "コピーしました" : "アーティスト名・アルバム名をコピー"}
          </button>
          <div style={{ height: "1px", backgroundColor: "var(--border-subtle)" }} />
          <button
            onClick={handleAoty}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors hover:bg-white/8"
            style={{ color: "var(--text-primary)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            AOTYで開く
          </button>
        </div>
      )}
    </div>
  );
}
