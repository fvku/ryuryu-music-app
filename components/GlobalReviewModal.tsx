"use client";

import { useEffect, useState } from "react";
import ReviewModal from "@/components/ReviewModal";
import { AlbumRef, useGlobalReviewModal } from "@/contexts/GlobalReviewModalContext";
import { ReleaseMasterAlbum } from "@/lib/types";

export default function GlobalReviewModal() {
  const { albumRef, closeAlbum } = useGlobalReviewModal();
  // 取得結果を取得時のalbumRefと紐付けて保持し、refが変わったら未取得扱いにする
  const [loaded, setLoaded] = useState<{ ref: AlbumRef; album: ReleaseMasterAlbum } | null>(null);

  useEffect(() => {
    if (!albumRef) return;
    const url = `/api/release-master/${albumRef.no}?title=${encodeURIComponent(albumRef.title)}&artist=${encodeURIComponent(albumRef.artist)}`;
    fetch(url)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setLoaded(data ? { ref: albumRef, album: data } : null))
      .catch(() => setLoaded(null));
  }, [albumRef]);

  const album = albumRef && loaded?.ref === albumRef ? loaded.album : null;
  if (!albumRef || !album) return null;

  return (
    <ReviewModal
      album={album}
      coverUrl={album.coverUrl}
      spotifyUrl={album.spotifyUrl}
      onClose={closeAlbum}
    />
  );
}
