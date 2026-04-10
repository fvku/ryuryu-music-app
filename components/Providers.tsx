"use client";

import { SessionProvider } from "next-auth/react";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { GlobalReviewModalProvider } from "@/contexts/GlobalReviewModalContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NotificationsProvider>
        <GlobalReviewModalProvider>{children}</GlobalReviewModalProvider>
      </NotificationsProvider>
    </SessionProvider>
  );
}
