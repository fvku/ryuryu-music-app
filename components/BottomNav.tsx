"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { useNotifications } from "@/contexts/NotificationsContext";

export default function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { hasNewForYou } = useNotifications();

  const tabs = [
    {
      href: "/",
      label: "ホーム",
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
    },
    {
      href: "/recommend",
      label: "タイムライン",
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      href: "/mypage",
      label: session?.user?.name ?? "マイページ",
      icon: (active: boolean) => {
        if (session?.user?.image) {
          return (
            <div className={`w-6 h-6 rounded-full overflow-hidden ring-2 transition-all ${active ? "ring-violet-500" : "ring-transparent"}`}>
              <Image src={session.user.image} alt={session.user.name ?? ""} width={24} height={24} className="object-cover" />
            </div>
          );
        }
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        );
      },
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t"
      style={{ backgroundColor: "rgba(15,15,19,0.95)", backdropFilter: "blur(12px)", borderColor: "var(--border-subtle)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="max-w-6xl mx-auto flex">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          const isMyPage = tab.href === "/mypage";
          return (
            <button
              key={tab.href}
              onClick={() => {
                if (isMyPage && !session) {
                  signIn("google");
                } else {
                  window.location.href = tab.href;
                }
              }}
              className="flex-1 flex flex-col items-center gap-1 py-4 transition-colors"
              style={{ color: active ? "var(--accent)" : "var(--text-secondary)" }}
            >
              <div className="relative">
                {tab.icon(active)}
                {isMyPage && hasNewForYou && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
                )}
              </div>
              <span className="text-xs font-medium max-w-[80px] truncate">{isMyPage && session?.user?.name ? session.user.name.split(" ")[0] : tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
