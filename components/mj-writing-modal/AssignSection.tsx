"use client";

import { ASSIGN_VALUES, CONTRIBUTOR_ASSIGN } from "./utils";

interface AssignSectionProps {
  currentAssign: string;
  picker: boolean;
  onTogglePicker: () => void;
  onClosePicker: () => void;
  onSelect: (value: string) => void;
}

/** 担当者（ASSIGN）ボタンとインラインdropdownピッカー */
export default function AssignSection({ currentAssign, picker, onTogglePicker, onClosePicker, onSelect }: AssignSectionProps) {
  const isContributor = currentAssign === CONTRIBUTOR_ASSIGN;
  const triggerStyle = isContributor
    ? { bg: "rgba(148,163,184,0.15)", fg: "#94a3b8", border: "rgba(148,163,184,0.3)" }
    : currentAssign
      ? { bg: "rgba(251,191,36,0.15)", fg: "#fbbf24", border: "rgba(251,191,36,0.3)" }
      : { bg: "rgba(107,114,128,0.15)", fg: "#6b7280", border: "var(--border-subtle)" };
  return (
    <div>
      <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>担当者（ASSIGN）</h3>
      <div className="relative">
        <button
          type="button"
          onClick={onTogglePicker}
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: triggerStyle.bg,
            color: triggerStyle.fg,
            border: `1px solid ${triggerStyle.border}`,
          }}
        >
          {currentAssign || "unassigned"}
          <span style={{ fontSize: "10px", opacity: 0.7 }}>✎</span>
        </button>

        {picker && (
          <>
            {/* 枠外タップで閉じるオーバーレイ */}
            <div className="fixed inset-0 z-[105]" onClick={onClosePicker} />
            <div
              className="absolute left-0 top-full mt-1 rounded-xl border p-3 min-w-[200px]"
              style={{ zIndex: 106, backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
            >
              <p className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>担当者を選択</p>
              <div className="flex flex-wrap gap-1.5">
                {ASSIGN_VALUES.map((v) => {
                  const selected = v === currentAssign;
                  const accent = v === CONTRIBUTOR_ASSIGN ? "148,163,184" : "251,191,36";
                  const accentFg = v === CONTRIBUTOR_ASSIGN ? "#94a3b8" : "#fbbf24";
                  return (
                    <button
                      key={v || "__empty__"}
                      type="button"
                      onClick={() => onSelect(v)}
                      className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                      style={{
                        backgroundColor: selected ? `rgba(${accent},0.2)` : "rgba(255,255,255,0.08)",
                        color: selected ? accentFg : "var(--text-secondary)",
                        border: `1px solid ${selected ? `rgba(${accent},0.4)` : "var(--border-subtle)"}`,
                      }}
                    >
                      {v || "なし"}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
