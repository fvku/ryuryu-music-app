"use client";

interface AssignConfirmDialogProps {
  currentAssign: string;
  pending: string | null;
  updating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** ASSIGN 確認ダイアログ */
export default function AssignConfirmDialog({ currentAssign, pending, updating, onCancel, onConfirm }: AssignConfirmDialogProps) {
  if (pending === null) return null;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
    >
      <div className="rounded-2xl p-6 w-full max-w-xs border" style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}>
        <p className="font-bold text-sm mb-1" style={{ color: "var(--text-primary)" }}>担当者を変更しますか？</p>
        <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
          <span style={{ color: "var(--text-primary)" }}>{currentAssign || "なし"}</span>
          {" → "}
          <span style={{ color: "#fbbf24", fontWeight: 600 }}>{pending || "なし"}</span>
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm border"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            disabled={updating}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            {updating ? "更新中..." : "変更する"}
          </button>
        </div>
      </div>
    </div>
  );
}
