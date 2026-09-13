"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeneratorHistoryEntry, GeneratorSnapshot } from "@/lib/generator/client-types";
import { generatorJson, snapshotWithLocks, type GeneratorApiError } from "../generator-client";
import type { GeneratorItemSource } from "@/lib/generator/model";
import type { Tone } from "../ui";
import { keyOf, lockPayload, lockToken, targetLabels, type ActiveLock, type LockKind, type LockResponse } from "./workspace-types";

export type Status = { tone: Tone; text: string };
export type SaveResult =
  | { ok: true; snapshot: GeneratorSnapshot }
  | { ok: false; error: GeneratorApiError };

type PendingSave = { requestId: string; signature: string };

function matchesLock(current: ActiveLock | undefined, expected: ActiveLock): boolean {
  return Boolean(current
    && current.clientId === expected.clientId
    && current.token === expected.token
    && current.generation === expected.generation);
}

/**
 * 共有DBとのやり取り（スナップショット、対象別ロック、対象別保存、画像アップロード、履歴）をまとめる。
 * 編集画面と共通設定画面の両方から使う。下書きの持ち方は画面ごとに違うので、ここでは持たない。
 *
 * 保存・ロックの不変条件は従来どおり。`requestId`は結果不明の再送でだけ再利用し、
 * `expectedVersion`は常に最新のスナップショットから取る（連続保存で古い版を送らないため）。
 */
export function useGeneratorSession({ initialSnapshot, actor, initialStatus }: {
  initialSnapshot: GeneratorSnapshot;
  actor: string;
  /** 画面ごとの最初の案内。編集画面と共通設定画面で出すことが違う。 */
  initialStatus?: string;
}) {
  const [snapshot, setSnapshotState] = useState(initialSnapshot);
  const [activeLocks, setActiveLocks] = useState<Record<string, ActiveLock>>({});
  const [history, setHistory] = useState<GeneratorHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({
    tone: "info",
    text: initialStatus || "画像を選び、「この画像を編集」から直します。保存はその画像ごとに新しいversionを作ります。",
  });
  const [clientId] = useState(() => crypto.randomUUID());
  const snapshotRef = useRef(snapshot), locksRef = useRef(activeLocks);
  // 応答不明の保存だけを同じrequestIdで再送するための、描画に関与しないインメモリキャッシュ。
  const [pendingSaves] = useState(() => new Map<string, PendingSave>());
  const documentId = snapshot.document.id;

  const setSnapshot = useCallback((value: GeneratorSnapshot | ((current: GeneratorSnapshot) => GeneratorSnapshot)) => {
    setSnapshotState(current => {
      const next = typeof value === "function" ? (value as (current: GeneratorSnapshot) => GeneratorSnapshot)(current) : value;
      snapshotRef.current = next;
      return next;
    });
  }, []);

  const setLocks = useCallback((value: (current: Record<string, ActiveLock>) => Record<string, ActiveLock>) => {
    setActiveLocks(current => {
      const next = value(current);
      locksRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/generator/documents/${documentId}/revisions`, { cache: "no-store" })
      .then(generatorJson<GeneratorHistoryEntry[]>)
      .then(value => { if (!cancelled) setHistory(value); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [documentId, snapshot.version]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const lock of Object.values(locksRef.current)) {
        void fetch(`/api/generator/documents/${documentId}/locks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "heartbeat", ...lockPayload(lock) }),
        })
          .then(generatorJson<LockResponse>)
          // 解放・引き継ぎ後の新しいロックを、古い応答で上書きしない。
          .then(result => setLocks(current => {
            const key = keyOf(lock.kind, lock.targetId);
            if (!matchesLock(current[key], lock)) return current;
            return { ...current, [key]: { ...current[key], expiresAt: result.expiresAt } };
          }))
          .catch(() => {
            // 解放・引き継ぎ後に届いた古い応答では何も言わない。
            // 実際に持っていたロックを失ったときだけ知らせる。
            let lost = false;
            setLocks(current => {
              const key = keyOf(lock.kind, lock.targetId);
              if (!matchesLock(current[key], lock)) return current;
              lost = true;
              const next = { ...current };
              delete next[key];
              return next;
            });
            if (lost) setStatus({ tone: "error", text: "編集ロックを失いました。「最新版に更新」してから、もう一度編集を開始してください。" });
          });
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [documentId, setLocks]);

  useEffect(() => () => {
    for (const lock of Object.values(locksRef.current)) {
      void fetch(`/api/generator/documents/${documentId}/locks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ action: "release", ...lockPayload(lock) }),
      });
    }
  }, [documentId]);

  const holds = useCallback((kind: LockKind, targetId: string) => Boolean(locksRef.current[keyOf(kind, targetId)]), []);

  const acquire = useCallback(async (
    kind: LockKind,
    targetId: string,
    action: "acquire" | "transfer" = "acquire",
  ): Promise<ActiveLock | null> => {
    const existing = locksRef.current[keyOf(kind, targetId)];
    if (existing) return existing;
    setBusy(true);
    const seed = { kind, targetId, clientId, token: lockToken() };
    try {
      const result = await generatorJson<LockResponse>(await fetch(`/api/generator/documents/${documentId}/locks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...seed }),
      }));
      const lock = { ...seed, generation: result.generation, expiresAt: result.expiresAt };
      setLocks(current => ({ ...current, [keyOf(kind, targetId)]: lock }));
      setSnapshot(current => ({
        ...current,
        locks: [
          ...current.locks.filter(value => !(value.kind === kind && value.targetId === targetId)),
          { kind, targetId, owner: result.owner, expiresAt: result.expiresAt },
        ],
      }));
      return lock;
    } catch (error) {
      setStatus({ tone: "error", text: (error as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }, [clientId, documentId, setLocks, setSnapshot]);

  /** 指定した対象のロックを解放する。期限切れのロックはすでに使えないので、失敗は無視してよい。 */
  const releaseMany = useCallback(async (targets: ActiveLock[]) => {
    if (!targets.length) return;
    setLocks(current => {
      const next = { ...current };
      for (const lock of targets) {
        const key = keyOf(lock.kind, lock.targetId);
        if (matchesLock(next[key], lock)) delete next[key];
      }
      return next;
    });
    setSnapshot(current => ({
      ...current,
      locks: current.locks.filter(value => !targets.some(lock => lock.kind === value.kind && lock.targetId === value.targetId)),
    }));
    await Promise.allSettled(targets.map(lock => fetch(`/api/generator/documents/${documentId}/locks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", ...lockPayload(lock) }),
    })));
  }, [documentId, setLocks, setSnapshot]);

  const release = useCallback(async (kind: LockKind, targetId: string) => {
    const lock = locksRef.current[keyOf(kind, targetId)];
    if (!lock) return;
    await releaseMany([lock]);
  }, [releaseMany]);

  const expectedVersionOf = useCallback((kind: LockKind, targetId: string): number => {
    const current = snapshotRef.current;
    if (kind === "item") return current.itemVersions[targetId];
    if (kind === "page") return current.pageVersions[targetId];
    if (kind === "structure") return current.structureVersion;
    return current.themeVersion;
  }, []);

  /**
   * 1つの対象を共有DBへ確定する。連続保存でも版が古くならないよう、`expectedVersion`は毎回最新から取る。
   * 呼び出し側が直前に取得したロックを使えるよう、`lock`を明示的に渡せる。
   */
  const saveTarget = useCallback(async ({ kind, targetId, content, source, restoreVersion, lock }: {
    kind: LockKind;
    targetId: string;
    content?: unknown;
    source?: GeneratorItemSource;
    restoreVersion?: number;
    lock?: ActiveLock;
  }): Promise<SaveResult> => {
    const held = lock || locksRef.current[keyOf(kind, targetId)];
    if (!held) {
      const error = Object.assign(new Error(`${targetLabels[kind]}の編集ロックがありません。`), { code: "LOCK_MISSING" }) as GeneratorApiError;
      return { ok: false, error };
    }
    const requestKey = keyOf(kind, targetId);
    const change = {
      ...lockPayload(held),
      expectedVersion: expectedVersionOf(kind, targetId),
      ...(restoreVersion ? { restoreVersion } : { content, ...(source ? { source } : {}) }),
    };
    const signature = JSON.stringify(change);
    const previousRequest = pendingSaves.get(requestKey);
    const requestId = previousRequest?.signature === signature ? previousRequest.requestId : crypto.randomUUID();
    pendingSaves.set(requestKey, { requestId, signature });
    try {
      const next = await generatorJson<GeneratorSnapshot>(await fetch(`/api/generator/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, ...change }),
      }));
      if (pendingSaves.get(requestKey)?.requestId === requestId) pendingSaves.delete(requestKey);
      setSnapshot(current => snapshotWithLocks(next, current.locks));
      return { ok: true, snapshot: next };
    } catch (error) {
      const value = error as GeneratorApiError;
      // 通信失敗・5xxはDBで確定済みか判別できない。同じ内容の再試行では同じrequestIdを使う。
      if (value.status !== undefined && value.status < 500 && pendingSaves.get(requestKey)?.requestId === requestId) {
        pendingSaves.delete(requestKey);
      }
      return { ok: false, error: value };
    }
  }, [documentId, expectedVersionOf, pendingSaves, setSnapshot]);

  const uploadImage = useCallback(async (kind: "item" | "theme", targetId: string, file: File): Promise<string | null> => {
    const lock = locksRef.current[keyOf(kind, targetId)];
    if (!lock) {
      setStatus({ tone: "warn", text: "画像を選ぶ前に「編集」を押してください。" });
      return null;
    }
    const form = new FormData(), assetId = crypto.randomUUID();
    form.set("file", file);
    form.set("assetId", assetId);
    form.set("kind", kind);
    form.set("targetId", targetId);
    form.set("clientId", lock.clientId);
    form.set("token", lock.token);
    form.set("generation", String(lock.generation));
    setBusy(true);
    setStatus({ tone: "info", text: "画像を検証して共有Storageへ保存しています…" });
    try {
      const result = await generatorJson<{ id: string }>(await fetch(`/api/generator/documents/${documentId}/assets`, { method: "POST", body: form }));
      setStatus({ tone: "success", text: "画像を保存しました。「保存」で版に確定してください。" });
      return result.id;
    } catch (error) {
      setStatus({ tone: "error", text: (error as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }, [documentId]);

  /** URLの画像はサーバーで取得する。配信元のCORSに依存せず、元バイトを再圧縮せず保存できる。 */
  const uploadImageUrl = useCallback(async (targetId: string, url: string): Promise<string | null> => {
    const lock = locksRef.current[keyOf("item", targetId)];
    if (!lock) {
      setStatus({ tone: "warn", text: "画像URLを取り込む前に「編集」を押してください。" });
      return null;
    }
    setBusy(true);
    setStatus({ tone: "info", text: "画像URLを安全に取得し、共有Storageへ保存しています…" });
    try {
      const result = await generatorJson<{ id: string }>(await fetch(`/api/generator/documents/${documentId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, assetId: crypto.randomUUID(), ...lockPayload(lock) }),
      }));
      setStatus({ tone: "success", text: "URLの画像を保存しました。「保存」で版に確定してください。" });
      return result.id;
    } catch (error) {
      setStatus({ tone: "error", text: (error as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }, [documentId]);

  const fetchSnapshot = useCallback(async (): Promise<GeneratorSnapshot | null> => {
    try {
      return await generatorJson<GeneratorSnapshot>(await fetch(`/api/generator/documents/${documentId}`, { cache: "no-store" }));
    } catch (error) {
      setStatus({ tone: "error", text: (error as Error).message });
      return null;
    }
  }, [documentId]);

  return {
    actor,
    documentId,
    snapshot,
    setSnapshot,
    snapshotRef,
    history,
    busy,
    setBusy,
    status,
    setStatus,
    activeLocks,
    locksRef,
    holds,
    acquire,
    release,
    releaseMany,
    saveTarget,
    uploadImage,
    uploadImageUrl,
    fetchSnapshot,
    pendingSaves,
    clientId,
  };
}

export type GeneratorSession = ReturnType<typeof useGeneratorSession>;
