"use client";

import { useEffect, useState } from "react";
import ReviewModal from "@/components/ReviewModal";
import { useGlobalReviewModal } from "@/contexts/GlobalReviewModalContext";
import { ReleaseMasterAlbum } from "@/lib/types";

export default function GlobalReviewModal() {
  const { albumRef, closeAlbum } = useGlobalReviewModal();
  const [album, setAlbum] = useState<ReleaseMasterAlbum | null>(null);

  useEffect(() => {
    if (!albumRef) {
      setAlbum(null);
      return;
    }
    const url = `/api/release-master/${albumRef.no}?title=${encodeURIComponent(albumRef.title)}&artist=${encodeURIComponent(albumRef.artist)}`;
    fetch(url)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setAlbum(data ?? null))
      .catch(() => setAlbum(null));
  }, [albumRef]);

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
