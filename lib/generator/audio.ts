import "server-only";
import { b2Config, b2ObjectUrl, deleteB2Object, inspectB2Object } from "./b2";
import { parseLock } from "./commands";
import { GeneratorError } from "./errors";
import { record, uuid } from "./model";
import { generatorRpc } from "./repository";

/**
 * 動画用の音声のアップロード・読み出し・期限切れの削除（HTTPルートとCronから使う本体）。
 * 流れはジャケット画像と同じ「ロック付きで準備 → 送る → サーバーが確かめて ready → 作品の保存で確定」。
 * 違いは、本文が大きいので送受信をブラウザと B2 の直接にしていること。
 */

export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp4"] as const;
/** ブラウザへ渡す URL の有効期限（秒）。PUT は送信の開始時点で確かめられるので、遅い回線でも数分あれば足りる。 */
const PUT_SECONDS = 600, GET_SECONDS = 300;

type AudioRow = { id: string; itemId: string; objectKey: string; status: "pending" | "ready" | "deleted"; mimeType: string; bytes: number; sha256: string; name: string; createdBy: string };

function invalid(message = "音声の情報が不正です。"): never { throw new GeneratorError("INVALID_INPUT", 400, message); }

/** ファイル名は表示にだけ使う。制御文字とパスの区切りを除き、200文字までにする。 */
export function audioDisplayName(value: unknown): string {
  if (typeof value !== "string") invalid();
  const name = value.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 200);
  return name || invalid();
}

function lockOf(input: Record<string, unknown>) {
  return parseLock({ action: "heartbeat", kind: input.kind, targetId: input.targetId, clientId: input.clientId, token: input.token, generation: input.generation }).lock;
}

const read = async (documentId: string, audioId: string) =>
  await generatorRpc("generator_audio_read", { p_id: documentId, p_audio_id: audioId }) as AudioRow;

export async function handleAudioCommand(documentId: string, actor: string, body: unknown): Promise<unknown> {
  const input = record(body, ["action", "audioId", "itemId", "mimeType", "bytes", "sha256", "name", "kind", "targetId", "clientId", "token", "generation"]);
  const audioId = uuid(input.audioId), lock = lockOf(input);
  if (input.action === "prepare") {
    b2Config(); // 保存先が未設定なら、記録を作る前に止める。
    const mimeType = input.mimeType;
    if (typeof mimeType !== "string" || !(AUDIO_MIME_TYPES as readonly string[]).includes(mimeType)) invalid("MP3 か AAC（m4a）の音声を送ってください。");
    if (typeof input.bytes !== "number" || !Number.isSafeInteger(input.bytes) || input.bytes < 1) invalid();
    if (input.bytes > AUDIO_MAX_BYTES) throw new GeneratorError("PAYLOAD_TOO_LARGE", 413, "音声ファイルは50MB以下にしてください。");
    if (typeof input.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.sha256)) invalid();
    const prepared = await generatorRpc("generator_audio_prepare", { p_id: documentId, p_actor: actor, p_lock: lock, p_audio: {
      id: audioId, itemId: uuid(input.itemId), mimeType, bytes: input.bytes, sha256: input.sha256, name: audioDisplayName(input.name),
    } }) as { objectKey: string; status: string };
    if (prepared.status === "ready") return { status: "ready" };
    return { status: "pending", uploadUrl: b2ObjectUrl("PUT", prepared.objectKey, PUT_SECONDS), headers: { "Content-Type": mimeType } };
  }
  if (input.action === "complete") {
    const row = await read(documentId, audioId);
    if (row.createdBy !== actor || row.status === "deleted") throw new GeneratorError("NOT_FOUND", 404, "対象が見つかりません。");
    if (row.status === "pending") {
      const checked = await inspectB2Object(row.objectKey, row);
      if (checked === "missing") throw new GeneratorError("AUDIO_NOT_UPLOADED", 409, "音声がまだ届いていません。もう一度選び直してください。");
      if (checked === "mismatch") {
        await deleteB2Object(row.objectKey).catch(() => undefined);
        throw new GeneratorError("AUDIO_MISMATCH", 400, "届いた音声が送ったファイルと一致しませんでした。もう一度選び直してください。");
      }
    }
    return await generatorRpc("generator_audio_ready", { p_id: documentId, p_actor: actor, p_audio_id: audioId, p_sha256: row.sha256, p_lock: lock });
  }
  return invalid();
}

/** 読み出し用の署名付きURL。ready の音声だけ。 */
export async function audioDownload(documentId: string, audioId: string) {
  const row = await read(documentId, audioId);
  if (row.status === "deleted") throw new GeneratorError("AUDIO_EXPIRED", 410, "保存期間（対象月の終わりから1年）を過ぎたため、この音声は削除されました。音声ファイルを選び直してください。");
  if (row.status !== "ready") throw new GeneratorError("NOT_FOUND", 404, "音声ファイルが見つかりません。");
  return { id: row.id, name: row.name, mimeType: row.mimeType, bytes: row.bytes, sha256: row.sha256, url: b2ObjectUrl("GET", row.objectKey, GET_SECONDS) };
}

/** 期限切れの音声を B2 から消す（日次Cron）。B2 が未設定の環境では何もしない。 */
export async function purgeExpiredAudio(limit = 100): Promise<{ deleted: number; failed: number; skipped?: string }> {
  try { b2Config(); } catch { return { deleted: 0, failed: 0, skipped: "AUDIO_NOT_CONFIGURED" }; }
  const expired = await generatorRpc("generator_audio_expired", { p_limit: limit }) as { documentId: string; id: string; objectKey: string }[];
  const removed: { documentId: string; id: string }[] = [];
  let failed = 0;
  for (const entry of expired) {
    try {
      await deleteB2Object(entry.objectKey);
      removed.push({ documentId: entry.documentId, id: entry.id });
    } catch { failed += 1; }
  }
  if (removed.length) await generatorRpc("generator_audio_forget", { p_items: removed });
  return { deleted: removed.length, failed };
}


