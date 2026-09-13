import { auth } from "@/lib/auth";
import { generatorActor } from "@/lib/generator/access";
import { GeneratorError } from "@/lib/generator/errors";
import { fetchGeneratorImage } from "@/lib/generator/remote-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  try {
    generatorActor(await auth());
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") throw new GeneratorError("INVALID_ORIGIN", 403, "同じサイトから画像を読み込んでください。");
    const url = new URL(request.url), values = url.searchParams.getAll("url");
    if (values.length !== 1 || [...url.searchParams.keys()].some(key => key !== "url")) {
      throw new GeneratorError("INVALID_IMAGE_URL", 400, "画像URLを1つ指定してください。");
    }
    const image = await fetchGeneratorImage(values[0]);
    return new Response(image.bytes.slice().buffer, {
      headers: { ...headers, "Content-Type": image.mimeType, "Content-Length": String(image.bytes.length) },
    });
  } catch (error) {
    const known = error instanceof GeneratorError ? error : new GeneratorError("INTERNAL_ERROR", 500, "画像を読み込めませんでした。");
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers });
  }
}
