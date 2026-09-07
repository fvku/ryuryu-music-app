import { auth } from "@/lib/auth";
import { generatorActor } from "@/lib/generator/access";
import { GeneratorError } from "@/lib/generator/errors";
import { uuid } from "@/lib/generator/model";
import { generatorRpc, generatorStorageRead } from "@/lib/generator/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  try {
    generatorActor(await auth());
    const params = await context.params, id = uuid(params.id), assetId = uuid(params.assetId);
    const asset = await generatorRpc("generator_asset_read", { p_id: id, p_asset_id: assetId }) as { path?: unknown; mimeType?: unknown; bytes?: unknown };
    if (typeof asset.path !== "string" || typeof asset.mimeType !== "string" || !["image/png","image/jpeg","image/webp"].includes(asset.mimeType)
      || !asset.path.startsWith(`${id}/${assetId}.`)) throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "保存画像の情報が不正です。");
    const bytes = await generatorStorageRead(asset.path);
    if (bytes.length !== asset.bytes) throw new GeneratorError("STORAGE_UNAVAILABLE", 503, "保存画像を検証できませんでした。");
    return new Response(bytes.slice().buffer, { headers: { ...responseHeaders, "Content-Type": asset.mimeType, "Content-Length": String(bytes.length) } });
  } catch (error) {
    const known = error instanceof GeneratorError ? error : new GeneratorError("INTERNAL_ERROR", 500, "保存画像を読み込めませんでした。");
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers: responseHeaders });
  }
}
