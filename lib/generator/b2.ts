import "server-only";
import { createHash, createHmac } from "node:crypto";
import { GeneratorError } from "./errors";

/**
 * 動画用の音声の置き場所（Backblaze B2 の非公開バケット、S3互換API）。
 *
 * Vercel Functions は本文・応答とも4.5MBまでなので、音声はサーバーを通さない。
 * サーバーが認可してから短時間だけ有効な署名付きURL（AWS Signature V4 のクエリ署名）を出し、ブラウザが B2 と直接やり取りする。
 * サーバー自身が B2 を読む・消すときも同じ署名付きURLを使う。依存を増やさないよう node:crypto だけで署名する。
 *
 * 環境変数（サーバー専用。NEXT_PUBLIC_ を付けない）：
 * B2_KEY_ID / B2_APPLICATION_KEY（このバケットだけに絞ったキー）/ B2_BUCKET / B2_ENDPOINT（例 s3.us-west-004.backblazeb2.com）
 */

export type PresignInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  host: string;
  /** 先頭が `/` のパス（エンコード前）。 */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 秒。S3 の上限は7日。 */
  expires: number;
  /** 署名に含める追加のクエリ（versionId など）。 */
  query?: Record<string, string>;
  now?: Date;
};

/** RFC 3986 の非予約文字以外をエンコードする（SigV4の規則）。パスでは `/` を残す。 */
function encode(value: string, keepSlash = false): string {
  return Array.from(new TextEncoder().encode(value), byte => {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(char) || (keepSlash && char === "/")) return char;
    return `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value, "utf8").digest();

/** 署名付きURL（クエリ署名）。署名する見出しは host だけ、本文は UNSIGNED-PAYLOAD。 */
export function presignUrl({ method, host, path, region, accessKeyId, secretAccessKey, expires, query: extra = {}, now = new Date() }: PresignInput): string {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
    ...Object.entries(extra),
  ];
  const canonicalQuery = query.map(([key, value]) => [encode(key), encode(value)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`).join("&");
  const canonicalPath = encode(path, true);
  const canonical = [method, canonicalPath, canonicalQuery, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical, "utf8").digest("hex")].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex");
  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

type B2Config = { host: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };

function notConfigured(): never {
  throw new GeneratorError("AUDIO_NOT_CONFIGURED", 503, "音声の保存先（Backblaze B2）が設定されていません。管理者に連絡してください。");
}

export function b2Config(): B2Config {
  const accessKeyId = process.env.B2_KEY_ID?.trim(), secretAccessKey = process.env.B2_APPLICATION_KEY?.trim();
  const bucket = process.env.B2_BUCKET?.trim(), endpoint = process.env.B2_ENDPOINT?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) notConfigured();
  const host = endpoint.replace(/^https:\/\//, "").replace(/\/+$/, "");
  const region = host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/)?.[1];
  if (!region || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) notConfigured();
  return { host, region, bucket, accessKeyId, secretAccessKey };
}

/** オブジェクトの署名付きURL。ブラウザへ渡すもの（PUT／GET）は数分で切れるようにする。 */
export function b2ObjectUrl(method: PresignInput["method"], objectKey: string, expires: number, query?: Record<string, string>): string {
  if (!/^audio\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp3|m4a)$/.test(objectKey)) {
    throw new GeneratorError("INVALID_INPUT", 400, "音声の保存先が不正です。");
  }
  const config = b2Config();
  return presignUrl({ method, host: config.host, path: `/${config.bucket}/${objectKey}`, region: config.region,
    accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, expires, query });
}

/** 先頭のバイトが、宣言した形式（MP3／MP4）のものか。 */
export function audioSignatureMatches(head: Uint8Array, mimeType: string): boolean {
  if (mimeType === "audio/mpeg") {
    const id3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
    const frame = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    return id3 || frame;
  }
  if (mimeType === "audio/mp4") return head.length >= 8 && String.fromCharCode(...head.slice(4, 8)) === "ftyp";
  return false;
}

/**
 * アップロード済みのオブジェクトを読み、サイズ・SHA-256・先頭のバイトを確かめる。
 * 届いていない（404）ときは null。宣言より大きいものは読み切らずに打ち切る。
 */
export async function inspectB2Object(objectKey: string, expected: { bytes: number; sha256: string; mimeType: string }): Promise<"ok" | "missing" | "mismatch"> {
  let response: Response;
  try {
    response = await fetch(b2ObjectUrl("GET", objectKey, 120), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "音声の保存先に接続できませんでした。もう一度試してください。");
  }
  if (response.status === 404) return "missing";
  if (!response.ok || !response.body) throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "アップロードした音声を確かめられませんでした。もう一度試してください。");
  const hash = createHash("sha256"), reader = response.body.getReader();
  let total = 0, head = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expected.bytes) { await reader.cancel().catch(() => undefined); return "mismatch"; }
    if (head.length < 16) head = Uint8Array.from([...head, ...value.slice(0, 16 - head.length)]);
    hash.update(value);
  }
  if (total !== expected.bytes || hash.digest("hex") !== expected.sha256 || !audioSignatureMatches(head, expected.mimeType)) return "mismatch";
  return "ok";
}

/**
 * オブジェクトを消す。B2 は既定で過去の版を残し、版を指定しない DELETE は「隠す」だけで容量が減らない。
 * そのため HEAD で版ID（x-amz-version-id）を読み、版を指定して消す。版が残っていれば繰り返す（通常は1つ）。
 * 既に無いときも成功とみなす。
 */
export async function deleteB2Object(objectKey: string): Promise<void> {
  const fail = () => { throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "音声を削除できませんでした。"); };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let head: Response;
    try {
      head = await fetch(b2ObjectUrl("HEAD", objectKey, 120), { method: "HEAD", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
    } catch { return fail(); }
    if (head.status === 404) return;
    const versionId = head.headers.get("x-amz-version-id");
    if (!head.ok || !versionId) return fail();
    let removed: Response;
    try {
      removed = await fetch(b2ObjectUrl("DELETE", objectKey, 120, { versionId }), { method: "DELETE", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
    } catch { return fail(); }
    if (!removed.ok && removed.status !== 404) return fail();
  }
  fail();
}
