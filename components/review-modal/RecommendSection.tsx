"use client";

import { useState } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { EMAIL_TO_SHORT_NAME } from "@/lib/members";

const ALL_MEMBERS: { email: string; name: string }[] = Object.entries(EMAIL_TO_SHORT_NAME).map(([email, name]) => ({ email, name }));

interface RecommendSectionProps {
  album: ReleaseMasterAlbum;
  coverUrl?: string;
  myEmail: string | null;
}

/** レコメンド投稿フォーム（認証済みのときのみレンダリングされる想定） */
export default function RecommendSection({ album, coverUrl, myEmail }: RecommendSectionProps) {
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendMessage, setRecommendMessage] = useState("");
  const [mentionedEmails, setMentionedEmails] = useState<string[]>([]);
  const [recommendSubmitting, setRecommendSubmitting] = useState(false);
  const [recommendSuccess, setRecommendSuccess] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);

  async function handleRecommend() {
    setRecommendSubmitting(true);
    setRecommendError(null);
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          albumNo: album.no,
          albumTitle: album.title,
          artistName: album.artist,
          coverUrl: coverUrl || "",
          message: recommendMessage.trim(),
          mentionedEmails,
          albumUid: album.uid,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "レコメンドに失敗しました");
      setRecommendSuccess(true);
      setIsRecommending(false);
      setRecommendMessage("");
      setMentionedEmails([]);
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setRecommendSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
      <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>レコメンド</h3>
      {recommendSuccess ? (
        <div className="rounded-xl p-3 border" style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)" }}>
          <p className="text-green-400 text-sm font-medium">レコメンドしました！</p>
        </div>
      ) : isRecommending ? (
        <div className="flex flex-col gap-3">
          {/* メンション選択 */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>メンション（複数選択可）</p>
            <div className="flex flex-wrap gap-2">
              {ALL_MEMBERS
                .filter((m) => m.email !== myEmail)
                .map((m) => {
                  const active = mentionedEmails.includes(m.email);
                  return (
                    <button
                      key={m.email}
                      type="button"
                      onClick={() => setMentionedEmails((prev) =>
                        active ? prev.filter((e) => e !== m.email) : [...prev, m.email]
                      )}
                      className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: active ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.06)",
                        color: active ? "white" : "var(--text-secondary)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}`,
                      }}
                    >
                      {active ? "✓ " : ""}{m.name}
                    </button>
                  );
                })}
            </div>
          </div>
          <textarea
            value={recommendMessage}
            onChange={(e) => setRecommendMessage(e.target.value)}
            placeholder="コメント（任意）"
            rows={2}
            className="w-full px-3 py-2 rounded-xl border text-sm resize-none"
            style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
          />
          {recommendError && <p className="text-red-400 text-xs">{recommendError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setIsRecommending(false); setRecommendError(null); setMentionedEmails([]); }} className="flex-1 py-2 rounded-xl text-sm border" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
              キャンセル
            </button>
            <button type="button" onClick={handleRecommend} disabled={recommendSubmitting} className="flex-1 py-2 rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "var(--accent)", color: "white" }}>
              {recommendSubmitting ? "送信中..." : "レコメンドする"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setIsRecommending(true)} className="w-full py-2.5 rounded-xl text-sm font-medium border" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
          このアルバムをレコメンドする
        </button>
      )}
    </div>
  );
}
