"use client";

import { SessionProvider } from "next-auth/react";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { GlobalReviewModalProvider } from "@/contexts/GlobalReviewModalContext";
import { SpotifyAddProvider } from "@/contexts/SpotifyAddContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NotificationsProvider>
        <GlobalReviewModalProvider>
          <SpotifyAddProvider>{children}</SpotifyAddProvider>
        </GlobalReviewModalProvider>
      </NotificationsProvider>
    </SessionProvider>
  );
}
