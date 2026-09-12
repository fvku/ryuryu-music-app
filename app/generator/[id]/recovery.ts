import { parseDocument, type GeneratorDocument } from "@/lib/generator/model";

/**
 * ブラウザ内の復旧用コピー。共有DBへの保存とは別物で、通信断・誤操作からの回復にだけ使う。
 * キー・`schemaVersion`・拒否条件は共有保存の契約どおり。編集画面と共通設定画面で同じ入れ物を使う。
 */
export type RecoveryPayload = { baseVersion: number; savedAt: string; document: GeneratorDocument };

export function recoveryKey(actor: string, documentId: string): string {
  return `ryuryu_generator_recovery:v1:${actor}:${documentId}`;
}

export function writeRecovery({ actor, documentId, baseVersion, document }: {
  actor: string;
  documentId: string;
  baseVersion: number;
  document: GeneratorDocument;
}): boolean {
  try {
    window.localStorage.setItem(recoveryKey(actor, documentId), JSON.stringify({
      schemaVersion: 1,
      actor,
      documentId,
      baseVersion,
      savedAt: new Date().toISOString(),
      document,
    }));
    return true;
  } catch {
    return false;
  }
}

export function hasRecovery(actor: string, documentId: string): boolean {
  try {
    return Boolean(window.localStorage.getItem(recoveryKey(actor, documentId)));
  } catch {
    return false;
  }
}

export function clearRecovery(actor: string, documentId: string): void {
  try {
    window.localStorage.removeItem(recoveryKey(actor, documentId));
  } catch { /* No recoverable local copy remains available to this page. */ }
}

/** 不正形式・未対応版・別アカウント・別文書は読み込まず、理由を持つ例外にする。 */
export function readRecovery(actor: string, documentId: string): RecoveryPayload {
  const raw = window.localStorage.getItem(recoveryKey(actor, documentId));
  if (!raw) throw new Error("復旧用コピーが見つかりません。");
  const value = JSON.parse(raw) as {
    schemaVersion?: unknown;
    actor?: unknown;
    documentId?: unknown;
    baseVersion?: unknown;
    savedAt?: unknown;
    document?: unknown;
  };
  if (value.schemaVersion !== 1 || value.actor !== actor || value.documentId !== documentId) {
    throw new Error("別の利用者または企画の復旧データです。");
  }
  if (typeof value.baseVersion !== "number" || !Number.isInteger(value.baseVersion) || value.baseVersion < 1
    || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))) {
    throw new Error("復旧データの版情報が不正、または未対応です。");
  }
  const document = parseDocument(value.document);
  if (document.id !== documentId) throw new Error("復旧データ内の企画IDが一致しません。");
  return { baseVersion: value.baseVersion, savedAt: value.savedAt, document };
}
