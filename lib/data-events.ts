"use client";

import { useEffect, useRef } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";

/**
 * 画面をまたぐ「保存しました」の通知。
 * モーダルで保存した結果を、開いている一覧（ホーム・マイページ・タイムライン）へ届けて、
 * 再読み込みしなくても点数・採用バッジ・保存リストが揃うようにする。
 *
 * - scores: レビューの投稿・更新。受け手はスコア一覧を取り直す
 * - bookmarks: 気になるリストの追加・解除
 * - recommendations: レコメンドの送信
 * - album: Release Master の1行の変更（M/J採用・ASSIGN・M/J原稿など）。patch をそのまま当てられる
 */
export type DataChange =
  | { kind: "scores"; albumNo: string }
  | { kind: "bookmarks"; albumNo: string; bookmarked: boolean }
  | { kind: "recommendations"; albumNo: string }
  | { kind: "album"; albumNo: string; patch: Partial<ReleaseMasterAlbum> };

export type DataChangeKind = DataChange["kind"];

const EVENT_NAME = "ryuryu:data-changed";

export function notifyDataChanged(change: DataChange): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DataChange>(EVENT_NAME, { detail: change }));
}

/** 指定した種類の変更を受け取る。handler は最新のものが呼ばれる（依存配列に入れなくてよい） */
export function useDataChanged(kinds: DataChangeKind[], handler: (change: DataChange) => void): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  const kindsKey = kinds.join(",");
  useEffect(() => {
    const wanted = new Set(kindsKey.split(","));
    const listener = (e: Event) => {
      const change = (e as CustomEvent<DataChange>).detail;
      if (change && wanted.has(change.kind)) handlerRef.current(change);
    };
    window.addEventListener(EVENT_NAME, listener);
    return () => window.removeEventListener(EVENT_NAME, listener);
  }, [kindsKey]);
}
