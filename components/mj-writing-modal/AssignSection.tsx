"use client";

import { ASSIGN_VALUES } from "./utils";

interface AssignSectionProps {
  currentAssign: string;
  picker: boolean;
  onTogglePicker: () => void;
  onClosePicker: () => void;
  onSelect: (value: string) => void;
}

/** 担当者（ASSIGN）ボタンとインラインdropdownピッカー */
export default function AssignSection({ currentAssign, picker, onTogglePicker, onClosePicker, onSelect }: AssignSectionProps) {
  return (
    <div>
      <h3 className="text-xs font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>担当者（ASSIGN）</h3>
      <div className="relative">
        <button
          type="button"
          onClick={onTogglePicker}
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: currentAssign ? "rgba(251,191,36,0.15)" : "rgba(107,114,128,0.15)",
            color: currentAssign ? "#fbbf24" : "#6b7280",
            border: `1px solid ${currentAssign ? "rgba(251,191,36,0.3)" : "var(--border-subtle)"}`,
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
                {ASSIGN_VALUES.map((v) => (
                  <button
                    key={v || "__empty__"}
                    type="button"
                    onClick={() => onSelect(v)}
                    className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                    style={{
                      backgroundColor: v === currentAssign ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.08)",
                      color: v === currentAssign ? "#fbbf24" : "var(--text-secondary)",
                      border: `1px solid ${v === currentAssign ? "rgba(251,191,36,0.4)" : "var(--border-subtle)"}`,
                    }}
                  >
                    {v || "なし"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
