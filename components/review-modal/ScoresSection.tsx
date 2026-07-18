"use client";

import { ReleaseMasterAlbum, Score } from "@/lib/types";
import ScoreBar from "@/components/ScoreBar";
import { LEGACY_NAME_TO_EMAIL, getDisplayName } from "@/lib/members";
import { getScoreColor, parseLegacyScore } from "./utils";

interface ScoresSectionProps {
  album: ReleaseMasterAlbum;
  /** legacy矛盾ガード（filterMismatchedScores）適用済みのスコアのみ渡すこと */
  validScores: Score[];
  loadingScores: boolean;
  combinedAverage: number | null;
  combinedCount: number;
}

/** 平均スコアカード・メンバーレビュー一覧・Release Master速報（純表示） */
export default function ScoresSection({ album, validScores, loadingScores, combinedAverage, combinedCount }: ScoresSectionProps) {
  const scoreColor = combinedAverage !== null ? getScoreColor(combinedAverage) : "#6b7280";

  // Release Master 速報：scoresに取り込まれていない分のみ表示
  const appScoredIds = new Set(validScores.map((s) => s.memberName.toLowerCase()));
  const pending = album.legacyScores.filter((ls) => {
    const email = LEGACY_NAME_TO_EMAIL[ls.name.toLowerCase()];
    if (email && appScoredIds.has(email)) return false;
    if (appScoredIds.has(ls.name.toLowerCase())) return false;
    return ls.value.trim() !== "";
  });

  return (
    <>
      {/* Average score */}
      {combinedAverage !== null && (
        <div className="rounded-2xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>平均スコア（{combinedCount}件）</span>
            <span className="text-3xl font-bold" style={{ color: scoreColor }}>
              {combinedAverage.toFixed(1)}
              <span className="text-sm font-normal ml-1" style={{ color: "var(--text-secondary)" }}>/10</span>
            </span>
          </div>
          <ScoreBar score={combinedAverage} showNumber={false} height="h-2" />
        </div>
      )}

      {/* Member scores */}
      {!loadingScores && validScores.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>メンバーのレビュー</h3>
          <div className="flex flex-col gap-3">
            {validScores.map((s, i) => (
              <div key={i} className="rounded-xl p-4 border" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: "rgba(139,92,246,0.2)", color: "var(--accent)" }}>
                      {getDisplayName(s.memberName).charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{getDisplayName(s.memberName)}</span>
                  </div>
                  {s.score !== null && (
                    <span className="font-bold text-base px-2 py-0.5 rounded-lg" style={{ color: getScoreColor(s.score), backgroundColor: `${getScoreColor(s.score)}18` }}>
                      {s.score % 1 === 0 ? s.score.toFixed(1) : s.score}
                    </span>
                  )}
                </div>
                {s.score !== null && <ScoreBar score={s.score} showNumber={false} height="h-1.5" />}
                {s.comment && <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{s.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Release Master 速報 */}
      {pending.length > 0 && (
        <div className="rounded-xl px-3 py-2 border" style={{ borderColor: "var(--border-subtle)", backgroundColor: "rgba(255,255,255,0.03)" }}>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Release Master 速報 · まもなく反映されます</p>
          <div className="flex flex-col gap-1.5">
            {pending.map((ls) => {
              const parsed = parseLegacyScore(ls.value);
              return (
                <div key={ls.name} className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs flex-shrink-0" style={{ color: "var(--text-secondary)" }}>{ls.name}</span>
                  {parsed.score !== null && (
                    <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--text-primary)" }}>
                      {parsed.score % 1 === 0 ? parsed.score.toFixed(1) : parsed.score}
                    </span>
                  )}
                  {parsed.comment && (
                    <span className="text-xs" style={{ color: "var(--text-secondary)", opacity: 0.8 }}>{parsed.comment}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
