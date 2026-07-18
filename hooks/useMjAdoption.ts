"use client";

import { useState } from "react";
import { ReleaseMasterAlbum } from "@/lib/types";

/**
 * M/J採用値の表示・選択ピッカー・確認ダイアログの状態管理。
 * バッジ（アルバム情報内）とオーバーレイ（モーダル直下）にまたがるため親で保持する。
 */
export function useMjAdoption(album: ReleaseMasterAlbum) {
  const [mjAdoption, setMjAdoption] = useState(album.mjAdoption ?? "");
  const [mjPicker, setMjPicker] = useState(false);
  const [mjPending, setMjPending] = useState<string | null>(null);
  const [mjUpdating, setMjUpdating] = useState(false);

  async function confirmMjUpdate() {
    if (mjPending === null) return;
    setMjUpdating(true);
    try {
      const res = await fetch(`/api/release-master/${album.no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mjAdoption: mjPending, uid: album.uid, title: album.title, artist: album.artist }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "更新失敗");
      setMjAdoption(mjPending);
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setMjUpdating(false);
      setMjPending(null);
      setMjPicker(false);
    }
  }

  return { mjAdoption, mjPicker, setMjPicker, mjPending, setMjPending, mjUpdating, confirmMjUpdate };
}
