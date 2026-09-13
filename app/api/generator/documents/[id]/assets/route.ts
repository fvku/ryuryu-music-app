import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { generatorActor, checkOrigin, readBody } from "@/lib/generator/access";
import { parseLock } from "@/lib/generator/commands";
import { GeneratorError } from "@/lib/generator/errors";
import { inspectGeneratorImage } from "@/lib/generator/image";
import { record, uuid } from "@/lib/generator/model";
import { fetchGeneratorImage } from "@/lib/generator/remote-image";
import { generatorRpc, generatorStorageUpload } from "@/lib/generator/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = generatorActor(await auth()); checkOrigin(request);
    const id = uuid((await context.params).id);
    const contentType = request.headers.get("content-type")?.split(";")[0].trim();
    let assetId: string, bytes: Uint8Array, image: ReturnType<typeof inspectGeneratorImage>, parsed: ReturnType<typeof parseLock>;
    if (contentType === "multipart/form-data") {
      if (Number(request.headers.get("content-length")) > 11 * 1024 * 1024) throw new GeneratorError("PAYLOAD_TOO_LARGE", 413, "画像は10MB以下にしてください。");
      const form = await request.formData(), file = form.get("file");
      if (!(file instanceof File) || file.size < 1 || file.size > 10 * 1024 * 1024) throw new GeneratorError("INVALID_IMAGE", 400, "PNG・JPEG・WebPの10MB以下の画像を選んでください。");
      assetId = uuid(form.get("assetId"));
      bytes = new Uint8Array(await file.arrayBuffer());
      image = inspectGeneratorImage(bytes, file.type);
      parsed = parseLock({ action: "heartbeat", kind: form.get("kind"), targetId: form.get("targetId"), clientId: form.get("clientId"), token: form.get("token"), generation: Number(form.get("generation")) });
    } else if (contentType === "application/json") {
      const input = record(await readBody(request), ["url", "assetId", "kind", "targetId", "clientId", "token", "generation"]);
      if (input.kind !== "item") throw new GeneratorError("INVALID_INPUT", 400, "画像URLは作品ジャケットにだけ使用できます。");
      assetId = uuid(input.assetId);
      parsed = parseLock({ action: "heartbeat", kind: input.kind, targetId: input.targetId, clientId: input.clientId, token: input.token, generation: input.generation });
      const fetched = await fetchGeneratorImage(input.url);
      bytes = fetched.bytes;
      image = fetched;
    } else {
      throw new GeneratorError("INVALID_CONTENT_TYPE", 415, "画像ファイルまたは画像URLを送信してください。");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const prepared = await generatorRpc("generator_asset_prepare", { p_id: id, p_actor: actor,
      p_asset: { id: assetId, mimeType: image.mimeType, bytes: bytes.length, width: image.width, height: image.height, sha256 }, p_lock: parsed.lock }) as { path?: unknown };
    const extension = image.mimeType === "image/png" ? "png" : image.mimeType === "image/jpeg" ? "jpg" : "webp";
    const expectedPath = `${id}/${assetId}.${extension}`;
    if (prepared.path !== expectedPath) throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "画像保存先を確認できませんでした。");
    await generatorStorageUpload(expectedPath, bytes, image.mimeType);
    return Response.json(await generatorRpc("generator_asset_ready", { p_id: id, p_actor: actor, p_asset_id: assetId, p_sha256: sha256, p_lock: parsed.lock }), { status: 201, headers });
  } catch (error) {
    const known = error instanceof GeneratorError ? error : new GeneratorError("INTERNAL_ERROR", 500, "画像を保存できませんでした。");
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers });
  }
}
