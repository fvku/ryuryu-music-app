import { generatorHandler } from "@/lib/generator/http";
import { readGeneratorReleaseMaster } from "@/lib/generator/release-master";
import { GeneratorError } from "@/lib/generator/errors";
import { matchStartTimes, type StartTimeQuery } from "@/lib/generator/video";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const text = (value: unknown, max = 300) => (typeof value === "string" ? value.slice(0, max) : "");

/**
 * 動画書き出しの初期値（おすすめ曲のStart Time）をRelease Masterから読むだけの口。
 * 読み取り専用で、共有DBにもRelease Masterにも書かない。POSTなのは照合の手がかりを本文で渡すため。
 */
export function POST(request: Request) {
  return generatorHandler(request, async (_actor, body) => {
    const raw = (body as { items?: unknown })?.items;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 60) throw new GeneratorError("INVALID_INPUT", 400, "作品を確認してください。");
    const queries: StartTimeQuery[] = raw.map(entry => {
      const value = (entry ?? {}) as Record<string, unknown>;
      return { id: text(value.id, 64), uid: text(value.uid, 64) || null, no: text(value.no, 32) || null, title: text(value.title), artist: text(value.artist) };
    }).filter(query => query.id);
    const albums = await readGeneratorReleaseMaster();
    return { startTimes: matchStartTimes(queries, albums) };
  }, true);
}
