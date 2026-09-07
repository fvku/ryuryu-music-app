import "server-only";
import { GeneratorError } from "./errors";

export type RpcName = "generator_create" | "generator_read" | "generator_lock" | "generator_save" | "generator_structure_save" | "generator_history" | "generator_asset_prepare" | "generator_asset_ready" | "generator_asset_read";
const conflicts = new Set(["DOCUMENT_EXISTS", "LOCK_CONFLICT", "LOCK_LOST", "VERSION_CONFLICT", "REQUEST_CONFLICT", "ASSET_NOT_READY"]);

export async function generatorRpc(name: RpcName, args: Record<string, unknown>): Promise<unknown> {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const key = secret || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.GENERATOR_ENABLED !== "true" || !url || !key) {
    throw new GeneratorError("GENERATOR_NOT_CONFIGURED", 503, "共有保存はまだ設定されていません。ローカル下書きとは別の機能です。");
  }
  let base: URL;
  try {
    base = new URL(url);
    if (base.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)
      || base.username || base.password || base.port || base.pathname !== "/" || base.search || base.hash) throw new Error();
  } catch { throw new GeneratorError("GENERATOR_NOT_CONFIGURED", 503, "共有保存の接続先設定を確認してください。"); }
  try {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, base), {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json", ...(!secret ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(args), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return await response.json();
    const body = await response.json().catch(() => ({}));
    // Never expose arbitrary provider responses, URLs, tokens or SQL details.
    const code: unknown = body?.message;
    if (body?.code === "23505") throw new GeneratorError("DOCUMENT_EXISTS", 409, "同じ期間の企画が既に存在します。");
    if (code === "NOT_FOUND") throw new GeneratorError("NOT_FOUND", 404, "対象が見つかりません。");
    if (code === "INVALID_INPUT") throw new GeneratorError("INVALID_INPUT", 400, "保存データが不正です。");
    if (typeof code === "string" && conflicts.has(code)) throw new GeneratorError(code, 409, "版・編集権・画像の状態が変わりました。最新状態を確認してください。");
    throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "共有保存に接続できません。変更は未保存です。");
  } catch (error) {
    if (error instanceof GeneratorError) throw error;
    throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "共有保存の結果を確認できません。同じ操作IDで再試行してください。");
  }
}

function storageConfiguration(): { base: URL; headers: Record<string, string> } {
  const url = process.env.SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY, key = secret || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.GENERATOR_ENABLED !== "true" || !url || !key) throw new GeneratorError("GENERATOR_NOT_CONFIGURED", 503, "画像保存はまだ設定されていません。");
  const base = new URL(url);
  if (base.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)) throw new GeneratorError("GENERATOR_NOT_CONFIGURED", 503, "画像保存の接続先設定を確認してください。");
  return { base, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

export async function generatorStorageUpload(path: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const { base, headers } = storageConfiguration();
  const response = await fetch(new URL(`/storage/v1/object/generator-assets/${path}`, base), { method: "POST", headers: { ...headers, "Content-Type": mimeType, "x-upsert": "false" }, body: bytes.slice().buffer, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok && response.status !== 409) throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "画像を共有保存できませんでした。");
}

export async function generatorStorageRead(path: string): Promise<Uint8Array> {
  const { base, headers } = storageConfiguration();
  const response = await fetch(new URL(`/storage/v1/object/generator-assets/${path}`, base), { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "保存画像を読み込めませんでした。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 10485760) throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "保存画像のサイズが不正です。");
  return bytes;
}
