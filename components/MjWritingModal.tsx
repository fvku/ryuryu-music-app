"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";
import { reportColumnError } from "@/components/ColumnErrorIndicator";

interface SpotifyTrack {
  trackNumber: number;
  name: string;
  durationMs: number;
}

interface Props {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  onClose: () => void;
  onSaved: (updated: Partial<ReleaseMasterAlbum>) => void;
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function MjWritingModal({ album, coverUrl, onClose, onSaved }: Props) {
  const [mounted, setMounted] = useState(false);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<SpotifyTrack | null>(null);
  const [text, setText] = useState<string>(() => album.mjText?.trim() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Scroll lock (iOS safe)
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.cssText = `position: fixed; top: -${scrollY}px; width: 100%; overflow-y: scroll;`;
    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
    };
  }, []);


  // Fetch Spotify tracks
  useEffect(() => {
    if (!album.spotifyUrl) return;
    setLoadingTracks(true);
    fetch(`/api/spotify/tracks?spotifyUrl=${encodeURIComponent(album.spotifyUrl)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SpotifyTrack[]) => {
        setTracks(data);
        // トラック番号 → 曲名の順で pre-select（番号を優先、名前が一致すればそちら）
        const trackNoNum = album.mjTrackNo ? parseInt(album.mjTrackNo.trim(), 10) : NaN;
        const byNo = !isNaN(trackNoNum) ? data.find((t) => t.trackNumber === trackNoNum) ?? null : null;
        const byName = album.mjTrack?.trim() ? data.find((t) => t.name === album.mjTrack.trim()) ?? null : null;
        const found = byName ?? byNo ?? null;
        if (found) setSelectedTrack(found);
      })
      .catch(() => {})
      .finally(() => setLoadingTracks(false));
  }, [album.spotifyUrl, album.mjTrackNo, album.mjTrack]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mjData: {
            trackNo: selectedTrack ? String(selectedTrack.trackNumber) : "",
            trackName: selectedTrack ? selectedTrack.name : "",
            mjText: text.trim(),
          },
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        if (errData.errorCode === "COLUMN_NOT_FOUND") {
          reportColumnError(errData.missing ?? []);
        }
        throw new Error(errData.error || "保存に失敗しました");
      }
      onSaved({
        mjTrackNo: selectedTrack ? String(selectedTrack.trackNumber) : "",
        mjTrack: selectedTrack ? selectedTrack.name : "",
        mjText: text.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  const charCount = text.length;
  const isValid = text.trim().length > 0 && charCount <= 300;

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
        style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
          style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
        >
          <div className="w-10 h-10" />
          <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
          <h2 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
            {text.length > 0 ? "M/J 文章を編集" : "M/J 文章を書く"}
          </h2>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-lg font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-6">
          {/* Album info */}
          <div className="flex items-center gap-3">
            <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
              {coverUrl && <Image src={coverUrl} alt={album.title} fill sizes="56px" className="object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
              <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{album.artist}</p>
              <span
                className="inline-block text-xs px-2 py-0.5 rounded-full mt-1 font-medium"
                style={{ backgroundColor: "rgba(139,92,246,0.15)", color: "var(--accent)" }}
              >
                {album.mjAdoption}
              </span>
            </div>
          </div>

          {/* Track selection */}
          <div>
            <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>
              おすすめトラック
              <span className="font-normal ml-1" style={{ color: "var(--text-secondary)" }}>(任意)</span>
            </h3>
            {selectedTrack && (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl" style={{ backgroundColor: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)" }}>
                <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>#{selectedTrack.trackNumber}</span>
                <span className="text-sm font-medium flex-1 truncate" style={{ color: "white" }}>{selectedTrack.name}</span>
                <button type="button" onClick={() => setSelectedTrack(null)} className="text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--text-secondary)" }}>外す</button>
              </div>
            )}
            {!album.spotifyUrl ? (
              <p className="text-xs py-2" style={{ color: "var(--text-secondary)" }}>Spotifyリンクなし</p>
            ) : loadingTracks ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>トラックを読み込み中...</span>
              </div>
            ) : (
              <div className="rounded-xl border overflow-hidden max-h-44 overflow-y-auto" style={{ borderColor: "var(--border-subtle)" }}>
                {tracks.map((track) => {
                  const isSelected = selectedTrack?.trackNumber === track.trackNumber;
                  return (
                    <button
                      key={track.trackNumber}
                      type="button"
                      onClick={() => setSelectedTrack(isSelected ? null : track)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                      style={{ backgroundColor: isSelected ? "rgba(139,92,246,0.15)" : "transparent" }}
                    >
                      <span className="w-5 text-xs text-right flex-shrink-0" style={{ color: isSelected ? "var(--accent)" : "var(--text-secondary)" }}>
                        {track.trackNumber}
                      </span>
                      <span className="flex-1 text-xs truncate" style={{ color: isSelected ? "white" : "var(--text-primary)" }}>
                        {track.name}
                      </span>
                      <span className="text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>
                        {formatDuration(track.durationMs)}
                      </span>
                      {isSelected && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Text editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>M/J 文章</h3>
              <span
                className="text-xs font-medium tabular-nums"
                style={{
                  color: charCount > 300 ? "#ef4444" : charCount >= 220 ? "#22c55e" : "var(--text-secondary)",
                }}
              >
                {charCount} / 300
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="220〜300字程度で文章を書いてください..."
              rows={9}
              className="w-full px-4 py-3 rounded-xl border text-sm leading-relaxed resize-none focus:outline-none focus:border-violet-500/50"
              style={{
                backgroundColor: "#0d0d14",
                borderColor: charCount > 300 ? "rgba(239,68,68,0.5)" : charCount >= 220 ? "rgba(34,197,94,0.4)" : "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            />
            <div className="flex justify-between items-center mt-1.5">
              {charCount > 0 && charCount < 220 ? (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>あと {220 - charCount} 字で最低文字数に達します</p>
              ) : charCount > 300 ? (
                <p className="text-xs" style={{ color: "#ef4444" }}>{charCount - 300} 字超過しています</p>
              ) : charCount >= 220 ? (
                <p className="text-xs" style={{ color: "#22c55e" }}>文字数OK</p>
              ) : <span />}
            </div>
          </div>

          {error && <p className="text-xs px-1" style={{ color: "#ef4444" }}>{error}</p>}

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isValid}
            className="w-full py-3.5 rounded-2xl font-bold text-sm transition-opacity disabled:opacity-40"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
