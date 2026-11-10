"use client";

import { useCallback, useEffect, useState } from "react";
import { ReleaseMasterAlbum, Score } from "@/lib/types";
import { errorMessageOf, fetchJsonOrThrow } from "@/lib/fetch-json";

/**
 * アルバムのアプリスコア一覧を取得する。投稿・更新後は refetchScores() で再取得。
 * 取得失敗は scoresError に入れ、「まだレビューがない」と区別する。
 */
export function useAlbumScores(album: ReleaseMasterAlbum) {
  const [scores, setScores] = useState<Score[]>([]);
  const [loadingScores, setLoadingScores] = useState(true);
  const [scoresError, setScoresError] = useState<string | null>(null);

  const fetchScores = useCallback(async () => {
    try {
      const data = await fetchJsonOrThrow<{ scores?: Score[] }>(
        `/api/scores/${album.no}?title=${encodeURIComponent(album.title)}&artist=${encodeURIComponent(album.artist)}&uid=${encodeURIComponent(album.uid)}`
      );
      setScores(data.scores || []);
      setScoresError(null);
    } catch (e) {
      setScoresError(errorMessageOf(e));
    } finally {
      setLoadingScores(false);
    }
  }, [album.no, album.title, album.artist, album.uid]);

  useEffect(() => {
    // 取得完了後にだけstateを更新する非同期処理（同期的なsetStateではない）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchScores();
  }, [fetchScores]);

  return { scores, loadingScores, scoresError, refetchScores: fetchScores };
}
