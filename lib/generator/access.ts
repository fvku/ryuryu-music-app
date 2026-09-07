import type { Session } from "next-auth";
import { isAllowedMember } from "../member-access";
import { GeneratorError } from "./errors";

type GeneratorAccessEnvironment = Partial<Record<
  "ALLOWED_MEMBER_EMAILS" | "AUTH_URL" | "NEXTAUTH_URL" | "VERCEL"
  | "GENERATOR_LOCAL_PREVIEW_AUTH_BYPASS" | "GENERATOR_LOCAL_PREVIEW_ACTOR",
  string
>>;

function localPreviewActor(environment: GeneratorAccessEnvironment, allowlist: string | undefined): string | null {
  if (environment.GENERATOR_LOCAL_PREVIEW_AUTH_BYPASS !== "true" || environment.VERCEL) return null;
  const configuredUrl = environment.AUTH_URL || environment.NEXTAUTH_URL;
  let hostname = "";
  try { hostname = configuredUrl ? new URL(configuredUrl).hostname : ""; } catch { return null; }
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) return null;
  const actor = environment.GENERATOR_LOCAL_PREVIEW_ACTOR;
  if (!actor || actor !== actor.trim().toLowerCase() || !isAllowedMember(actor, allowlist)) {
    throw new GeneratorError("GENERATOR_PREVIEW_MISCONFIGURED", 503, "ローカルプレビューの利用者設定が不正です。");
  }
  return actor;
}

export function generatorActor(
  session: Session | null,
  allowlist = process.env.ALLOWED_MEMBER_EMAILS,
  environment: GeneratorAccessEnvironment = process.env as GeneratorAccessEnvironment,
): string {
  const previewActor = localPreviewActor(environment, allowlist);
  if (previewActor) return previewActor;
  const email = session?.user?.email;
  if (!email) throw new GeneratorError("UNAUTHENTICATED", 401, "Googleでログインしてください。");
  if (!isAllowedMember(email, allowlist)) throw new GeneratorError("FORBIDDEN", 403, "アクセスが許可されていません。");
  if (session.loginProvider !== "google" || session.googleVerifiedEmail !== email) {
    throw new GeneratorError("GOOGLE_REAUTH_REQUIRED", 401, "ジェネレーターを使うにはGoogleで再ログインしてください。");
  }
  return email;
}

export function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    throw new GeneratorError("INVALID_ORIGIN", 403, "同じサイトから操作してください。");
  }
}

export async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new GeneratorError("INVALID_CONTENT_TYPE", 415, "JSON形式で送信してください。");
  }
  const limit = 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new GeneratorError("PAYLOAD_TOO_LARGE", 413, "保存データが大きすぎます。");
  const reader = request.body?.getReader();
  if (!reader) throw new GeneratorError("INVALID_INPUT", 400, "保存データがありません。");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new GeneratorError("PAYLOAD_TOO_LARGE", 413, "保存データが大きすぎます。"); }
      chunks.push(chunk.value);
    }
    const data = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (error) {
    if (error instanceof GeneratorError) throw error;
    throw new GeneratorError("INVALID_INPUT", 400, "JSONを読み込めませんでした。");
  } finally { reader.releaseLock(); }
}
