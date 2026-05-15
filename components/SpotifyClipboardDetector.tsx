"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useGlobalReviewModal } from "@/contexts/GlobalReviewModalContext";
import { useSpotifyAdd } from "@/contexts/SpotifyAddContext";

interface AlbumInfo {
  id: string;
  title: string;
  artist: string;
  albumType?: string;
  waboku?: string;
  releaseDate: string;
  trackCount: number;
  totalDurationMs: number;
  coverUrl: string;
  spotifyUrl: string;
  tracks: { name: string; durationMs: number }[];
}

type PopupState =
  | { type: "idle" }
  | { type: "input" }
  | { type: "loading" }
  | { type: "exists"; album: AlbumInfo; no: string }
  | { type: "new"; album: AlbumInfo }
  | { type: "added"; album: AlbumInfo; no: string }
  | { type: "error"; message: string };

// ロケールプレフィックス（/intl-ja/ 等）とクエリパラメータを無視してアルバムIDを抽出
const SPOTIFY_ALBUM_RE = /open\.spotify\.com\/(?:[^/]+\/)?album\/([A-Za-z0-9]+)/;

export default function SpotifyClipboardDetector() {
  const { data: session } = useSession();
  const { openAlbum } = useGlobalReviewModal();
  const { register } = useSpotifyAdd();
  const [popup, setPopup] = useState<PopupState>({ type: "idle" });
  const [inputUrl, setInputUrl] = useState("");
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const lastProcessedId = useRef<string | null>(null);

  const processUrl = useCallback(async (text: string) => {
    const match = text.match(SPOTIFY_ALBUM_RE);
    if (!match) {
      setPopup({ type: "error", message: "SpotifyのアルバムURLが見つかりませんでした" });
      return;
    }
    const albumId = match[1];

    if (lastProcessedId.current === albumId) return;

    setPopup({ type: "loading" });

    try {
      const [albumRes, checkRes] = await Promise.all([
        fetch(`/api/spotify/album?id=${albumId}`),
        fetch(`/api/sheets/check-album?spotifyId=${albumId}`),
      ]);

      if (!albumRes.ok) {
        const err = await albumRes.text();
        setPopup({ type: "error", message: `Spotify取得失敗: ${err}` });
        return;
      }
      if (!checkRes.ok) {
        const err = await checkRes.text();
        setPopup({ type: "error", message: `シート確認失敗: ${err}` });
        return;
      }

      const [album, checkData]: [AlbumInfo, { exists: boolean; no?: string }] = await Promise.all([
        albumRes.json(),
        checkRes.json(),
      ]);

      lastProcessedId.current = albumId;

      if (checkData.exists) {
        setPopup({ type: "exists", album, no: checkData.no ?? "" });
        return;
      }

      setPopup({ type: "new", album });
    } catch (e) {
      setPopup({ type: "error", message: String(e) });
    }
  }, []);

  const tryClipboardSilently = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const match = text.match(SPOTIFY_ALBUM_RE);
      if (!match) {
        setDetectedUrl(null);
        return;
      }
      const albumId = match[1];
      if (lastProcessedId.current === albumId) return;
      setDetectedUrl(text);
    } catch {
      // Permission denied — ボタンは非表示のまま
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    tryClipboardSilently(); // マウント時に一度確認
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        tryClipboardSilently();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [session, tryClipboardSilently]);

  useEffect(() => {
    register(() => {
      if (detectedUrl) processUrl(detectedUrl);
      else setPopup({ type: "input" });
    });
  }, [detectedUrl, processUrl, register]);

  const handleButtonClick = async () => {
    if (detectedUrl) {
      await processUrl(detectedUrl);
    }
  };

  const handleAdd = async (album: AlbumInfo) => {
    setPopup({ type: "loading" });
    try {
      const res = await fetch("/api/sheets/add-album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(album),
      });
      const data = await res.json();
      if (!res.ok) {
        setPopup({ type: "error", message: data.error ?? "追加に失敗しました" });
        return;
      }
      setPopup({ type: "added", album, no: data.no ?? "" });
    } catch (e) {
      setPopup({ type: "error", message: String(e) });
    }
  };

  const dismiss = () => {
    setPopup({ type: "idle" });
  };

  const isVisible = popup.type !== "idle";

  return (
    <>
      {/* Center popup */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4"
        aria-hidden={!isVisible}
      >
        {isVisible && (
          <div
            className="absolute inset-0 pointer-events-auto"
            style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            onClick={dismiss}
          />
        )}

        <div
          className={`relative w-full max-w-sm rounded-2xl p-5 transition-all duration-200 ease-out ${isVisible ? "pointer-events-auto" : "pointer-events-none"}`}
          style={{
            backgroundColor: "var(--bg-card, #1a1a22)",
            border: "1px solid var(--border-subtle)",
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "scale(1)" : "scale(0.95)",
          }}
        >
          {popup.type === "input" && (
            <div>
              <p className="text-sm font-medium mb-3">SpotifyのアルバムURLを貼り付け</p>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://open.spotify.com/album/..."
                className="w-full text-sm px-3 py-2 rounded-lg mb-3 outline-none"
                style={{
                  backgroundColor: "rgba(255,255,255,0.07)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
                autoFocus
              />
              <button
                onClick={() => processUrl(inputUrl)}
                disabled={!inputUrl.trim()}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
                style={{ backgroundColor: "#1DB954", color: "#fff" }}
              >
                確認
              </button>
            </div>
          )}

          {popup.type === "loading" && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>確認中…</p>
            </div>
          )}

          {(popup.type === "new" || popup.type === "exists" || popup.type === "added") && (
            <>
              {/* アルバム情報エリア — exists/added の場合はクリックでレビューページへ */}
              <div
                className={`flex items-start gap-4 mb-4 ${(popup.type === "exists" || popup.type === "added") && popup.no ? "cursor-pointer rounded-xl -mx-1 px-1 py-1 hover:bg-white/5 transition-colors" : ""}`}
                onClick={() => {
                  if ((popup.type === "exists" || popup.type === "added") && popup.no) {
                    dismiss();
                    openAlbum({ no: popup.no, title: popup.album.title, artist: popup.album.artist });
                  }
                }}
              >
                {popup.album.coverUrl && (
                  <Image
                    src={popup.album.coverUrl}
                    alt={popup.album.title}
                    width={72}
                    height={72}
                    className="rounded-lg flex-shrink-0 object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm leading-tight truncate">{popup.album.title}</p>
                    {(popup.album.albumType === "ep" || (popup.album.albumType === "single" && popup.album.trackCount >= 4)) && (
                      <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: "rgba(29,185,84,0.2)", color: "#1DB954" }}>EP</span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                    {popup.album.artist}
                  </p>
                  <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "var(--text-tertiary, #666)" }}>
                    {popup.album.trackCount}曲
                    {popup.album.waboku && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                        {popup.album.waboku}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); dismiss(); }}
                  className="flex-shrink-0 text-lg leading-none"
                  style={{ color: "var(--text-secondary)" }}
                  aria-label="閉じる"
                >
                  ×
                </button>
              </div>

              {popup.type === "exists" && (
                <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
                  登録済みです（No.{popup.no}）　タップしてレビューを開く
                </p>
              )}

              {popup.type === "new" && (
                <button
                  onClick={() => handleAdd(popup.album)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#1DB954", color: "#fff" }}
                >
                  Release Masterに追加
                </button>
              )}

              {popup.type === "added" && (
                <p className="text-xs text-center font-medium" style={{ color: "#1DB954" }}>
                  追加しました。{popup.no ? "タップしてレビューを開く" : ""}
                </p>
              )}
            </>
          )}

          {popup.type === "error" && (
            <div className="py-4 text-center">
              <p className="text-sm" style={{ color: "#f87171" }}>{popup.message}</p>
              <button
                onClick={dismiss}
                className="mt-3 text-xs underline"
                style={{ color: "var(--text-secondary)" }}
              >
                閉じる
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
