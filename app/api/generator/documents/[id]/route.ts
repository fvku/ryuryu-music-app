import { generatorHandler } from "@/lib/generator/http";
import { generatorRpc } from "@/lib/generator/repository";
import { uuid } from "@/lib/generator/model";
import { parseChange } from "@/lib/generator/commands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return generatorHandler(request, async () => generatorRpc("generator_read", { p_id: uuid((await context.params).id) }));
}
// Targeted save only. No full-document overwrite is accepted.
export function PATCH(request: Request, context: Context) {
  return generatorHandler(request, async (actor, body) => {
    const command = parseChange(body);
    const rpc = command.change.kind === "structure"
      ? "generator_structure_save"
      : command.change.kind === "item" && ("source" in command.change || "restoreVersion" in command.change)
        ? "generator_item_save"
        : "generator_save";
    return generatorRpc(rpc, { p_id: uuid((await context.params).id), p_actor: actor, p_request_id: command.requestId, p_change: command.change });
  }, true);
}
