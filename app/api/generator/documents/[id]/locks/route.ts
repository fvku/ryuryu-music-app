import { generatorHandler } from "@/lib/generator/http";
import { generatorRpc } from "@/lib/generator/repository";
import { uuid } from "@/lib/generator/model";
import { parseLock } from "@/lib/generator/commands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return generatorHandler(request, async (actor, body) => {
    const command = parseLock(body);
    return generatorRpc("generator_lock", { p_id: uuid((await context.params).id), p_actor: actor, p_action: command.action, p_lock: command.lock });
  }, true);
}
