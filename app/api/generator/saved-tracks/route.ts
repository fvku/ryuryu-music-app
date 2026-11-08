import { auth } from "@/lib/auth";
import { generatorActor } from "@/lib/generator/access";
import { GeneratorError } from "@/lib/generator/errors";
import { fetchSavedTracks } from "@/lib/generator/saved-tracks-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  try {
    generatorActor(await auth());
    return Response.json(await fetchSavedTracks(), { headers });
  } catch (error) {
    const known = error instanceof GeneratorError ? error : new GeneratorError("INTERNAL_ERROR", 500, "プレイリストを読み込めませんでした。");
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers });
  }
}
