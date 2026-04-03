"use client";

import { SessionProvider } from "next-auth/react";
import { NotificationsProvider } from "@/contexts/NotificationsContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NotificationsProvider>{children}</NotificationsProvider>
    </SessionProvider>
  );
}
