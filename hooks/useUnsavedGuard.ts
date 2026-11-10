"use client";

import { useCallback, useEffect, useRef } from "react";

export const UNSAVED_CONFIRM_MESSAGE = "保存していない入力があります。閉じてもよいですか？\n（下書きはこの端末に残るので、次に開いたときに戻せます）";

/**
 * 未保存の入力があるモーダルを閉じる前に確認する。
 * - guardedClose: 背景タップ・Esc・閉じるボタン・下スワイプから呼ぶ
 * - ページの再読み込み・タブを閉じる操作にはブラウザ標準の確認を出す
 * dirty はレンダーごとに最新値を渡す。
 */
export function useUnsavedGuard(dirty: boolean, onClose: () => void, confirmFn: (msg: string) => boolean = defaultConfirm) {
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザ向け。文言は表示されない
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return useCallback(() => {
    if (dirtyRef.current && !confirmFn(UNSAVED_CONFIRM_MESSAGE)) return;
    onClose();
  }, [onClose, confirmFn]);
}

function defaultConfirm(message: string): boolean {
  return typeof window === "undefined" ? true : window.confirm(message);
}
