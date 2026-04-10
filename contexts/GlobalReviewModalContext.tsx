"use client";

import { createContext, useContext, useState } from "react";

interface GlobalReviewModalContextValue {
  albumNo: string | null;
  openAlbum: (no: string) => void;
  closeAlbum: () => void;
}

const GlobalReviewModalContext = createContext<GlobalReviewModalContextValue>({
  albumNo: null,
  openAlbum: () => {},
  closeAlbum: () => {},
});

export function GlobalReviewModalProvider({ children }: { children: React.ReactNode }) {
  const [albumNo, setAlbumNo] = useState<string | null>(null);

  return (
    <GlobalReviewModalContext.Provider
      value={{
        albumNo,
        openAlbum: (no) => setAlbumNo(no),
        closeAlbum: () => setAlbumNo(null),
      }}
    >
      {children}
    </GlobalReviewModalContext.Provider>
  );
}

export function useGlobalReviewModal() {
  return useContext(GlobalReviewModalContext);
}
