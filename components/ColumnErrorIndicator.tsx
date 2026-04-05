"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const COLUMN_ERROR_KEY = "ryuryu_column_error";
export const COLUMN_ERROR_EVENT = "ryuryu:columnError";

/** 列エラーをlocalStorageに保存し、UIに通知する（クライアント側から呼び出す） */
export function reportColumnError(missing: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COLUMN_ERROR_KEY, JSON.stringify({ missing, timestamp: Date.now() }));
    window.dispatchEvent(new CustomEvent(COLUMN_ERROR_EVENT, { detail: { missing } }));
  } catch {}
}

export default function ColumnErrorIndicator() {
  const [missing, setMissing] = useState<string[] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // ページロード時にlocalStorageから読み込む
    try {
      const stored = localStorage.getItem(COLUMN_ERROR_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.missing?.length > 0) setMissing(data.missing);
      }
    } catch {}

    // リアルタイム通知を受け取る
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.missing?.length > 0) {
        setMissing(detail.missing);
      } else {
        setMissing(null);
      }
    };
    window.addEventListener(COLUMN_ERROR_EVENT, handler);
    return () => window.removeEventListener(COLUMN_ERROR_EVENT, handler);
  }, []);

  if (!mounted || !missing) {
    // エラーなし: 元のスペーサーと同じ幅を維持
    return <div className="w-16" />;
  }

  return (
    <>
      <div className="w-16 flex items-center">
        <button
          onClick={() => setShowModal(true)}
          className="relative flex items-center justify-center w-8 h-8"
          aria-label="スプレッドシートエラーの詳細を表示"
        >
          {/* pulse ring */}
          <span className="absolute inset-0 rounded-full animate-ping opacity-40" style={{ backgroundColor: "#ef4444" }} />
          <span className="absolute inset-0 rounded-full" style={{ backgroundColor: "rgba(239,68,68,0.2)" }} />
          <span className="relative text-sm font-bold leading-none" style={{ color: "#ef4444" }}>!</span>
        </button>
      </div>

      {showModal && createPortal(
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center px-6"
          style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
            style={{
              backgroundColor: "var(--bg-primary)",
              border: "1px solid rgba(239,68,68,0.4)",
            }}
          >
            {/* Icon + title */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(239,68,68,0.15)" }}
              >
                <span className="text-lg font-bold" style={{ color: "#ef4444" }}>!</span>
              </div>
              <h2 className="font-bold text-base" style={{ color: "var(--text-primary)" }}>
                スプレッドシートエラー
              </h2>
            </div>

            {/* Missing columns */}
            <div
              className="rounded-xl p-4 border"
              style={{ backgroundColor: "rgba(239,68,68,0.07)", borderColor: "rgba(239,68,68,0.3)" }}
            >
              <p className="text-xs font-medium mb-2" style={{ color: "#ef4444" }}>見つからない列:</p>
              <ul className="flex flex-col gap-1.5">
                {missing.map((c) => (
                  <li
                    key={c}
                    className="text-xs font-mono px-2.5 py-1.5 rounded-lg"
                    style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--text-primary)" }}
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              スプレッドシートの列名が変更または削除された可能性があります。
              データ保護のため、該当する書き込みはブロックされています。
            </p>

            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              開発者に連絡ください
            </p>

            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="w-full py-3 rounded-xl text-sm font-medium transition-opacity hover:opacity-70"
              style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
            >
              閉じる
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
