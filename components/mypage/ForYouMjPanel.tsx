"use client";

import Image from "next/image";
import { ReleaseMasterAlbum } from "@/lib/types";
import { getAssignInfo, hasMjText, mjAdoptionOrder } from "./utils";

interface ForYouMjPanelProps {
  mjAlbums: ReleaseMasterAlbum[];
  spotifyData: Record<string, { coverUrl: string; spotifyUrl: string }>;
  mjMonthFilter: string;
  onMjMonthFilterChange: (m: string) => void;
  mjTypeFilter: "all" | "monthly" | "japan";
  onMjTypeFilterChange: (f: "all" | "monthly" | "japan") => void;
  userEmail: string;
  onSelectMjAlbum: (album: ReleaseMasterAlbum) => void;
}

/** FOR YOU > M/J文章モード: 月/MONTHLY・JAPANフィルターと担当割り当て一覧 */
export default function ForYouMjPanel({
  mjAlbums, spotifyData, mjMonthFilter, onMjMonthFilterChange, mjTypeFilter, onMjTypeFilterChange,
  userEmail, onSelectMjAlbum,
}: ForYouMjPanelProps) {
  const mjMonths = ["すべて", ...Array.from(new Set(mjAlbums.map((a) => a.date?.substring(0, 7)).filter(Boolean))).sort().reverse()];

  const filteredMjAlbums = mjAlbums
    .filter((a) => mjMonthFilter === "すべて" || a.date?.substring(0, 7) === mjMonthFilter)
    .filter((a) => {
      if (mjTypeFilter === "monthly") return a.mjAdoption === "採用" || a.mjAdoption === "掲載";
      if (mjTypeFilter === "japan") return a.mjAdoption === "J採用" || a.mjAdoption === "J掲載";
      return true;
    })
    .sort((a, b) => {
      // 1. 採用 → 掲載
      const adoptDiff = mjAdoptionOrder(a.mjAdoption) - mjAdoptionOrder(b.mjAdoption);
      if (adoptDiff !== 0) return adoptDiff;
      // 2. リリース日（古い順）
      const dateDiff = (a.date ?? "").localeCompare(b.date ?? "");
      if (dateDiff !== 0) return dateDiff;
      // 3. アーティスト名アルファベット順
      return (a.artist ?? "").localeCompare(b.artist ?? "");
    });

  return (
    <>
      {/* 月フィルター + MONTHLY/JAPAN タブ */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <select
          value={mjMonthFilter}
          onChange={(e) => onMjMonthFilterChange(e.target.value)}
          className="px-3 py-1 rounded-xl border text-xs font-medium focus:outline-none flex-shrink-0"
          style={{
            backgroundColor: "var(--bg-card)",
            borderColor: mjMonthFilter !== "すべて" ? "var(--accent)" : "var(--border-subtle)",
            color: mjMonthFilter !== "すべて" ? "white" : "var(--text-secondary)",
          }}
        >
          {mjMonths.map((m) => (
            <option key={m} value={m}>
              {m === "すべて" ? "すべて" : `${m.split("/")[0]}年${parseInt(m.split("/")[1])}月`}
            </option>
          ))}
        </select>
        {(["all", "monthly", "japan"] as const).map((f) => (
          <button
            key={f}
            onClick={() => onMjTypeFilterChange(f)}
            className="px-3 py-1 rounded-lg border text-xs font-bold transition-colors flex-shrink-0"
            style={{
              backgroundColor: mjTypeFilter === f ? "rgba(139,92,246,0.2)" : "transparent",
              color: mjTypeFilter === f ? "white" : "var(--text-secondary)",
              borderColor: mjTypeFilter === f ? "var(--accent)" : "var(--border-subtle)",
            }}
          >
            {f === "all" ? "すべて" : f === "monthly" ? "MONTHLY" : "JAPAN"}
          </button>
        ))}
      </div>

      {filteredMjAlbums.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">📝</p>
          <p style={{ color: "var(--text-secondary)" }}>該当するアルバムはありません</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredMjAlbums.map((album) => {
            const cover = spotifyData[album.no]?.coverUrl || album.coverUrl;
            const assignInfo = getAssignInfo(album, userEmail);
            const hasText = hasMjText(album);
            return (
              <div
                key={album.no}
                onClick={() => onSelectMjAlbum(album)}
                className="flex items-center gap-4 p-4 rounded-2xl border transition-all hover:-translate-y-0.5 hover:border-violet-500/40 cursor-pointer active:scale-[0.99]"
                style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
              >
                <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                  {cover ? (
                    <Image src={cover} alt={album.title} fill sizes="56px" className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{album.title}</p>
                  <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{album.artist}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{album.date}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(139,92,246,0.12)", color: "var(--accent)" }}>
                      {(album.mjAdoption === "採用" || album.mjAdoption === "掲載") ? "MONTHLY" : "JAPAN"}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium" style={{
                      backgroundColor: (album.mjAdoption === "採用" || album.mjAdoption === "J採用") ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)",
                      color: (album.mjAdoption === "採用" || album.mjAdoption === "J採用") ? "#22c55e" : "#eab308",
                    }}>
                      {(album.mjAdoption === "採用" || album.mjAdoption === "J採用") ? "採用" : "掲載"}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                  {assignInfo === null ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(107,114,128,0.15)", color: "#6b7280" }}>
                      unassigned
                    </span>
                  ) : assignInfo.isMe ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: "rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                      ASSIGNED
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(139,92,246,0.15)", color: "var(--accent)" }}>
                      {assignInfo.name}
                    </span>
                  )}
                  {hasText && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
                      済み
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
