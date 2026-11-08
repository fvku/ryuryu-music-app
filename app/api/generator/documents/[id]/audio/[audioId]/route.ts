import { audioDownload } from "@/lib/generator/audio";
import { generatorHandler } from "@/lib/generator/http";
import { uuid } from "@/lib/generator/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 同じ文書の ready の音声だけ、短時間有効な読み出しURLを返す。本文はブラウザが B2 から直接読む。 */
export function GET(request: Request, context: { params: Promise<{ id: string; audioId: string }> }) {
  return generatorHandler(request, async () => {
    const params = await context.params;
    return audioDownload(uuid(params.id), uuid(params.audioId));
  });
}
