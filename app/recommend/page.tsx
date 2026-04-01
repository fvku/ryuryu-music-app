"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Recommendation } from "@/lib/sheets";

export default function RecommendPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/recommendations")
      .then((r) => r.ok ? r.json() : Promise.reject("取得に失敗しました"))
      .then((data) => setRecommendations(data))
      .catch((e) => setError(typeof e === "string" ? e : "エラーが発生しました"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-12 h-12 rounded-full border-4 animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
        <p style={{ color: "var(--text-secondary)" }}>読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl p-8 text-center border" style={{ backgroundColor: "var(--bg-card)", borderColor: "rgba(239,68,68,0.3)" }}>
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>レコメンド</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>メンバーからのおすすめアルバム</p>
      </div>

      {recommendations.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <p className="text-4xl mb-4">💿</p>
          <p style={{ color: "var(--text-secondary)" }}>まだレコメンドがありません</p>
          <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>アルバムページからレコメンドできます</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {[...recommendations].reverse().map((rec) => (
            <div
              key={rec.id}
              className="rounded-2xl p-5 border"
              style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
            >
              <div className="flex gap-4 items-center">
                <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0" style={{ backgroundColor: "#2a2a3a" }}>
                  {rec.coverUrl ? (
                    <Image src={rec.coverUrl} alt={rec.albumTitle} fill sizes="56px" className="object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#6b7280" }}>
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>{rec.albumTitle}</p>
                  <p className="text-xs truncate mt-0.5" style={{ color: "var(--accent)" }}>{rec.artistName}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                      {rec.recommenderId.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{rec.recommenderId} がレコメンド</span>
                  </div>
                </div>
              </div>
              {rec.message && (
                <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  &ldquo;{rec.message}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
