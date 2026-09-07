import { generatorHandler } from "@/lib/generator/http";
import { generatorRpc } from "@/lib/generator/repository";
import { uuid } from "@/lib/generator/model";
import { version } from "@/lib/generator/commands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return generatorHandler(request, async () => {
    const before = new URL(request.url).searchParams.get("before");
    return generatorRpc("generator_history", { p_id: uuid((await context.params).id), ...(before === null ? {} : { p_before: version(Number(before)) }) });
  });
}
