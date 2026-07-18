"use client";

import { useEffect, useState } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { isSameAlbum } from "@/lib/score-utils";

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
    setBookmarkLoading(true);
    try {
      const body = JSON.stringify({ albumTitle: album.title, artistName: album.artist, albumUid: album.uid });
      if (bookmarked) {
        await fetch("/api/bookmarks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body });
        setBookmarked(false);
      } else {
        await fetch("/api/bookmarks", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        setBookmarked(true);
      }
    } finally {
      setBookmarkLoading(false);
    }
  }

  return { bookmarked, bookmarkLoading, toggleBookmark };
}
