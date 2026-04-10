"use client";

import { useEffect, useState } from "react";
import ReviewModal from "@/components/ReviewModal";
import { useGlobalReviewModal } from "@/contexts/GlobalReviewModalContext";
import { ReleaseMasterAlbum } from "@/lib/types";

export default function GlobalReviewModal() {
  const { albumNo, closeAlbum } = useGlobalReviewModal();
  const [album, setAlbum] = useState<ReleaseMasterAlbum | null>(null);

  useEffect(() => {
    if (!albumNo) {
      setAlbum(null);
      return;
    }
    fetch(`/api/release-master/${albumNo}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setAlbum(data ?? null))
      .catch(() => setAlbum(null));
  }, [albumNo]);

  if (!albumNo || !album) return null;

  return (
    <ReviewModal
      album={album}
      coverUrl={album.coverUrl}
      spotifyUrl={album.spotifyUrl}
      onClose={closeAlbum}
    />
  );
}
