"use client";

interface TextEditorProps {
  text: string;
  onTextChange: (value: string) => void;
}

/** M/J文章テキストエリア＋文字数カウント */
export default function TextEditor({ text, onTextChange }: TextEditorProps) {
  const charCount = text.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>M/J 文章</h3>
        <span
          className="text-xs font-medium tabular-nums"
          style={{ color: charCount > 300 ? "#fb923c" : charCount >= 220 ? "#22c55e" : "var(--text-secondary)" }}
        >
          {charCount} / 300
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="220〜300字程度で文章を書いてください..."
        rows={9}
        className="w-full px-4 py-3 rounded-xl border text-sm leading-relaxed resize-none focus:outline-none focus:border-violet-500/50"
        style={{
          backgroundColor: "#0d0d14",
          borderColor: charCount > 300 ? "rgba(251,146,60,0.5)" : charCount >= 220 ? "rgba(34,197,94,0.4)" : "var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      />
      <div className="flex justify-between items-center mt-1.5">
        {charCount > 0 && charCount < 220 ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>あと {220 - charCount} 字で最低文字数に達します</p>
        ) : charCount > 300 ? (
          <p className="text-xs" style={{ color: "#fb923c" }}>{charCount - 300} 字超過しています（保存は可能です）</p>
        ) : charCount >= 220 ? (
          <p className="text-xs" style={{ color: "#22c55e" }}>文字数OK</p>
        ) : <span />}
      </div>
    </div>
  );
}
