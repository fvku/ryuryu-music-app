"use client";

import { createContext, useContext, useRef } from "react";

interface SpotifyAddContextValue {
  triggerOpen: () => void;
  register: (fn: () => void) => void;
}

const SpotifyAddContext = createContext<SpotifyAddContextValue>({
  triggerOpen: () => {},
  register: () => {},
});

export function SpotifyAddProvider({ children }: { children: React.ReactNode }) {
  const fnRef = useRef<(() => void) | null>(null);
  return (
    <SpotifyAddContext.Provider
      value={{
        triggerOpen: () => fnRef.current?.(),
        register: (fn) => { fnRef.current = fn; },
      }}
    >
      {children}
    </SpotifyAddContext.Provider>
  );
}

export const useSpotifyAdd = () => useContext(SpotifyAddContext);
