"use client";

import { Tab } from "@/hooks/useMyPageData";

interface TabBarProps {
  tabs: { key: Tab; label: string; count: number }[];
  tab: Tab;
  hasNewForYou: boolean;
  onTabChange: (key: Tab) => void;
}

/** SAVED/FOR YOU/REVIEWEDのタブ切替バー（未読赤丸・件数バッジ付き） */
export default function TabBar({ tabs, tab, hasNewForYou, onTabChange }: TabBarProps) {
  return (
    <div className="flex border-b mb-5" style={{ borderColor: "var(--border-subtle)" }}>
      {tabs.map(({ key, label, count }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className="flex-1 py-3 text-xs font-bold tracking-wide transition-colors"
          style={{
            color: tab === key ? "var(--accent)" : "var(--text-secondary)",
            borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          <span className="relative inline-flex items-center gap-1">
            {label}
            {key === "foryou" && hasNewForYou && (
              <span className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
            {count > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tab === key ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.08)" }}>
                {count}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
