"use client";

import { createContext, useContext, useState } from "react";

interface AlbumRef {
  no: string;
  title: string;
  artist: string;
}

interface GlobalReviewModalContextValue {
  albumRef: AlbumRef | null;
  openAlbum: (ref: AlbumRef) => void;
  closeAlbum: () => void;
}

const GlobalReviewModalContext = createContext<GlobalReviewModalContextValue>({
  albumRef: null,
  openAlbum: () => {},
  closeAlbum: () => {},
});

export function GlobalReviewModalProvider({ children }: { children: React.ReactNode }) {
  const [albumRef, setAlbumRef] = useState<AlbumRef | null>(null);

  return (
    <GlobalReviewModalContext.Provider
      value={{
        albumRef,
        openAlbum: (ref) => setAlbumRef(ref),
        closeAlbum: () => setAlbumRef(null),
      }}
    >
      {children}
    </GlobalReviewModalContext.Provider>
  );
}

export function useGlobalReviewModal() {
  return useContext(GlobalReviewModalContext);
}
