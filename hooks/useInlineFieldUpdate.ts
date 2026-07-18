"use client";

import { useState } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";
import { reportColumnError } from "@/components/ColumnErrorIndicator";

type InlineField = "mjAssign" | "mjAdoption";

/**
 * ASSIGN・M/J採用のような「バッジ/ボタン→ピッカーで選択→確認ダイアログでPATCH」という
 * 共通パターンの状態管理。Release Masterの1列を更新する。
 */
export function useInlineFieldUpdate(
  album: ReleaseMasterAlbum,
  field: InlineField,
  initialValue: string,
  onSaved: (updated: Partial<ReleaseMasterAlbum>) => void
) {
  const [current, setCurrent] = useState(initialValue);
  const [picker, setPicker] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  async function confirm() {
    if (pending === null) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: pending, uid: album.uid, title: album.title, artist: album.artist }),
      });
      if (!res.ok) {
        const errData = await res.json();
        if (errData.errorCode === "COLUMN_NOT_FOUND") reportColumnError(errData.missing ?? []);
        throw new Error(errData.error || "更新失敗");
      }
      setCurrent(pending);
      onSaved({ [field]: pending } as Partial<ReleaseMasterAlbum>);
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setUpdating(false);
      setPending(null);
      setPicker(false);
    }
  }

  return { current, picker, setPicker, pending, setPending, updating, confirm };
}
