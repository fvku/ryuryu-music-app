"use client";

import { useEffect, useState } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { Recommendation } from "@/lib/sheets";
import { getDisplayName } from "@/lib/members";

/** このアルバムへの既存レコメンド一覧（fetchごと自己完結。0件なら何も表示しない） */
export default function RecommendationList({ album }: { album: ReleaseMasterAlbum }) {
  const [albumRecs, setAlbumRecs] = useState<Recommendation[]>([]);

  useEffect(() => {
    fetch(`/api/recommendations?albumTitle=${encodeURIComponent(album.title)}&artistName=${encodeURIComponent(album.artist)}&albumUid=${encodeURIComponent(album.uid)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((recs: Recommendation[]) =>
        setAlbumRecs(recs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
      );
  }, [album.title, album.artist, album.uid]);

  if (albumRecs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>レコメンド ({albumRecs.length})</h3>
      {albumRecs.map((rec) => (
        <div key={rec.id} className="rounded-xl px-3 py-2.5 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
              {getDisplayName(rec.recommenderId).charAt(0).toUpperCase()}
            </div>
            <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{getDisplayName(rec.recommenderId)}</span>
            {rec.mentionedEmails.length > 0 && (
              <span className="text-xs flex items-center gap-1 flex-wrap">
                {rec.mentionedEmails.map((e) => (
                  <span key={e} className="px-1.5 py-0.5 rounded-full text-xs" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}>
                    @{getDisplayName(e)}
                  </span>
                ))}
              </span>
            )}
            <span className="text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>
              {new Date(rec.createdAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
            </span>
          </div>
          {rec.message && (
            <p className="text-xs mt-1.5 leading-relaxed pl-7" style={{ color: "var(--text-secondary)" }}>
              &ldquo;{rec.message}&rdquo;
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
