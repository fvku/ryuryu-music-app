"use client";

import { useCallback, useEffect, useState } from "react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";

/** アルバムのアプリスコア一覧を取得する。投稿・更新後は refetchScores() で再取得 */
export function useAlbumScores(album: ReleaseMasterAlbum) {
  const [scores, setScores] = useState<Score[]>([]);
  const [loadingScores, setLoadingScores] = useState(true);

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch(`/api/scores/${album.no}?title=${encodeURIComponent(album.title)}&artist=${encodeURIComponent(album.artist)}&uid=${encodeURIComponent(album.uid)}`);
      if (res.ok) {
        const data = await res.json();
        setScores(data.scores || []);
      }
    } finally {
      setLoadingScores(false);
    }
  }, [album.no, album.title, album.artist, album.uid]);

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  return { scores, loadingScores, refetchScores: fetchScores };
}
