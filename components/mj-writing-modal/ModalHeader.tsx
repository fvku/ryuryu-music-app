"use client";

interface ModalHeaderProps {
  hasText: boolean;
  onClose: () => void;
}

export default function ModalHeader({ hasText, onClose }: ModalHeaderProps) {
  return (
    <div
      className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
      style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
    >
      <div className="w-10 h-10" />
      <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
      <h2 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
        {hasText ? "M/J 文章を編集" : "M/J 文章を書く"}
      </h2>
      <button
        onClick={onClose}
        className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-lg font-medium"
        style={{ color: "var(--text-secondary)" }}
      >
        ✕
      </button>
    </div>
  );
}
