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
    if (!session?.user?.email) return;

    async function checkNew() {
      try {
        const [recsRes, seenRes] = await Promise.all([
          fetch("/api/recommendations?forUser=me"),
          fetch("/api/notifications/seen"),
        ]);
        if (!recsRes.ok) return;
        const recs: Recommendation[] = await recsRes.json();
        if (recs.length === 0) return;

        let seenAt: string | null = null;
        if (seenRes.ok) {
          seenAt = ((await seenRes.json()) as { seenAt: string | null }).seenAt;
          if (!seenAt) {
            // サーバー未登録 → localStorageに旧既読値があれば一度だけ移行
            const legacy = localStorage.getItem(LS_KEY);
            if (legacy) {
              seenAt = legacy;
              fetch("/api/notifications/seen", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ seenAt: legacy }),
              }).catch(() => {});
            }
          }
        } else {
          // API失敗時のみlocalStorageにフォールバック
          seenAt = localStorage.getItem(LS_KEY);
        }

        if (!seenAt) { setHasNewForYou(true); return; }
        const seenTime = new Date(seenAt).getTime();
        setHasNewForYou(recs.some((r) => new Date(r.createdAt).getTime() > seenTime));
      } catch {}
    }

    checkNew();
  }, [session]);

  const markForYouSeen = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(LS_KEY, now);
    setHasNewForYou(false);
    fetch("/api/notifications/seen", { method: "POST" }).catch(() => {});
  }, []);

  return (
    // 未ログイン時は常にfalse（内部stateはリセットせず、値の側で吸収する）
    <NotificationsContext.Provider value={{ hasNewForYou: session?.user?.email ? hasNewForYou : false, markForYouSeen }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
