"use client";

import { MJ_ADOPTION_VALUES } from "@/lib/sheet-headers";

interface MjAdoptionDialogsProps {
  mjAdoption: string;
  mjPicker: boolean;
  mjPending: string | null;
  mjUpdating: boolean;
  onClosePicker: () => void;
  onSelect: (value: string) => void;
  onCancelPending: () => void;
  onConfirm: () => void;
}

/** M/J採用の選択ピッカーと確認ダイアログ（モーダルルート直下にオーバーレイ表示） */
export default function MjAdoptionDialogs({ mjAdoption, mjPicker, mjPending, mjUpdating, onClosePicker, onSelect, onCancelPending, onConfirm }: MjAdoptionDialogsProps) {
  return (
    <>
      {/* M/J採用 ピッカー */}
      {mjPicker && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={onClosePicker}
        >
          <div
            className="rounded-2xl border p-4 w-full max-w-xs"
            style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>M/J採用を選択</p>
            <div className="flex flex-wrap gap-2">
              {MJ_ADOPTION_VALUES.map((v) => (
                <button
                  key={v}
                  onClick={() => onSelect(v)}
                  className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
                  style={{
                    backgroundColor: v === mjAdoption ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.08)",
                    color: v === mjAdoption ? "white" : "var(--text-secondary)",
                    border: `1px solid ${v === mjAdoption ? "var(--accent)" : "var(--border-subtle)"}`,
                  }}
                >
                  {v === "" ? "空欄（なし）" : v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* M/J採用 確認ダイアログ */}
      {mjPending !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div className="rounded-2xl p-6 w-full max-w-xs border" style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}>
            <p className="font-bold text-sm mb-1" style={{ color: "var(--text-primary)" }}>M/J採用を変更しますか？</p>
            <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--text-primary)" }}>{mjAdoption || "空欄"}</span>
              {" → "}
              <span style={{ color: "var(--accent)", fontWeight: "600" }}>{mjPending === "" ? "空欄" : mjPending}</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={onCancelPending}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                キャンセル
              </button>
              <button
                onClick={onConfirm}
                disabled={mjUpdating}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)", color: "white" }}
              >
                {mjUpdating ? "更新中..." : "変更する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
