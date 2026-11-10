"use client";

import { useEffect, useState } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { isSameAlbum } from "@/lib/score-utils";
import { notifyDataChanged } from "@/lib/data-events";

/** 気になるリスト（bookmarks）の取得とトグル。未認証時は何も取得しない */
export function useBookmark(album: ReleaseMasterAlbum, status: "authenticated" | "loading" | "unauthenticated") {
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/bookmarks")
        .then((r) => r.ok ? r.json() : [])
        .then((bms: { albumTitle: string; artistName: string; albumUid?: string }[]) =>
          setBookmarked(bms.some((b) => isSameAlbum(album, b)))
        );
    }
  }, [status, album]);

  async function toggleBookmark() {
    if (bookmarkLoading) return;
    setBookmarkLoading(true);
    const next = !bookmarked;
    try {
      const body = JSON.stringify({ albumTitle: album.title, artistName: album.artist, albumUid: album.uid });
      const res = await fetch("/api/bookmarks", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body,
      });
      // 保存できなかったのに保存済みの色にしない（後で見つからない原因になる）
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || (res.status === 401 ? "ログインし直してください" : `HTTP ${res.status}`));
      }
      setBookmarked(next);
      notifyDataChanged({ kind: "bookmarks", albumNo: album.no, bookmarked: next });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "";
      alert(`${next ? "保存" : "保存の解除"}に失敗しました。もう一度お試しください${reason ? `\n（${reason}）` : ""}`);
    } finally {
      setBookmarkLoading(false);
    }
  }

  return { bookmarked, bookmarkLoading, toggleBookmark };
}
