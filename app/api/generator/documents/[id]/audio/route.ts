import { handleAudioCommand } from "@/lib/generator/audio";
import { generatorHandler } from "@/lib/generator/http";
import { uuid } from "@/lib/generator/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// B2 上の音声（最大50MB）を読んでハッシュを確かめるため、既定より長めに待てるようにする。
export const maxDuration = 120;

/**
 * 動画用の音声のアップロード。`action: "prepare"` で署名付きの PUT URL を受け取り、ブラウザが B2 へ直接送ったあと、
 * `action: "complete"` でサーバーがサイズ・SHA-256 を確かめて ready にする。どちらも作品のロックが必要。
 */
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return generatorHandler(request, async (actor, body) => handleAudioCommand(uuid((await context.params).id), actor, body), true);
}
