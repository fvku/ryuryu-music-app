"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Recommendation } from "@/lib/sheets";

const LS_KEY = "ryuryu_foryou_seen_at";

interface NotificationsContextValue {
  hasNewForYou: boolean;
  markForYouSeen: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  hasNewForYou: false,
  markForYouSeen: () => {},
});

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [hasNewForYou, setHasNewForYou] = useState(false);

  useEffect(() => {
    if (!session?.user?.email) { setHasNewForYou(false); return; }

    async function checkNew() {
      try {
        const res = await fetch("/api/recommendations?forUser=me");
        if (!res.ok) return;
        const recs: Recommendation[] = await res.json();
        if (recs.length === 0) return;

        const seenAt = localStorage.getItem(LS_KEY);
        if (!seenAt) { setHasNewForYou(true); return; }
        const seenTime = new Date(seenAt).getTime();
        setHasNewForYou(recs.some((r) => new Date(r.createdAt).getTime() > seenTime));
      } catch {}
    }

    checkNew();
  }, [session]);

  const markForYouSeen = useCallback(() => {
    localStorage.setItem(LS_KEY, new Date().toISOString());
    setHasNewForYou(false);
  }, []);

  return (
    <NotificationsContext.Provider value={{ hasNewForYou, markForYouSeen }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
