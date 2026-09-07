import type { FieldKey } from "../hit-test";
import type { ItemContent } from "@/lib/generator/model";

export type LockKind = "item" | "page" | "theme" | "structure";
export type ActiveLock = { kind: LockKind; targetId: string; clientId: string; token: string; generation: number; expiresAt: string };
export type LockResponse = { generation: number; expiresAt: string; owner: string };

export const targetLabels: Record<LockKind, string> = { item: "作品", page: "背景", theme: "共通設定", structure: "並び順" };

export function keyOf(kind: LockKind, targetId: string): string {
  return `${kind}:${targetId}`;
}

export function lockPayload(lock: ActiveLock) {
  return { kind: lock.kind, targetId: lock.targetId, clientId: lock.clientId, token: lock.token, generation: lock.generation };
}

export function lockToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

export function cloneContent(content: ItemContent): ItemContent {
  return structuredClone(content);
}

export function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 調整対象と選択範囲。`source` は「どこで選ばれたか」。
 * - `preview`：マウス・ペンでプレビューから選ばれた。入力欄を開き、フォーカスまで移す。
 * - `previewTouch`：タッチでプレビューから選ばれた。入力欄は開くがフォーカスは移さない（キーボードを出さない）。
 * - `previewOpen`：プレビュー由来で開いた欄の中で、利用者が選び直した。開いたままにするがフォーカスは触らない。
 * - `field`：入力欄や一覧から選ばれた。プレビュー由来の欄は閉じる。
 */
export type FieldSelection = {
  itemId: string;
  slotIndex: number;
  key: FieldKey;
  start: number;
  end: number;
  source: "preview" | "previewTouch" | "previewOpen" | "field";
};
