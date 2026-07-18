"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";

const CLOSE_THRESHOLD = 120;

/**
 * モーダルの閉じる系挙動をまとめたフック:
 * Escapeキーで閉じる・bodyスクロールロック（iOS Safari対応）・
 * ヘッダーの下方向ドラッグで閉じる。
 * dragY/isDragging はモーダル本体の transform に、headerTouchHandlers はヘッダーに渡す。
 */
export function useModalDismiss(onClose: () => void) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll (iOS Safari compatible)
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.cssText = `position: fixed; top: -${scrollY}px; width: 100%; overflow-y: scroll;`;
    return () => {
      document.body.style.cssText = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  const touchStartY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  function handleHeaderTouchStart(e: TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }

  function handleHeaderTouchMove(e: TouchEvent) {
    if (touchStartY.current === null) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) setDragY(delta);
  }

  function handleHeaderTouchEnd() {
    if (dragY >= CLOSE_THRESHOLD) {
      onClose();
    } else {
      setDragY(0);
    }
    setIsDragging(false);
    touchStartY.current = null;
  }

  return {
    dragY,
    isDragging,
    headerTouchHandlers: {
      onTouchStart: handleHeaderTouchStart,
      onTouchMove: handleHeaderTouchMove,
      onTouchEnd: handleHeaderTouchEnd,
    },
  };
}
