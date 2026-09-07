import { generatorHandler } from "@/lib/generator/http";
import { generatorRpc } from "@/lib/generator/repository";
import { parseDocument, record, uuid } from "@/lib/generator/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET(request: Request) {
  return generatorHandler(request, () => generatorRpc("generator_read", { p_id: null }));
}
export function POST(request: Request) {
  return generatorHandler(request, async (actor, value) => {
    const body = record(value, ["requestId", "document"]);
    const snapshot = await generatorRpc("generator_create", {
      p_document: parseDocument(body.document), p_actor: actor, p_request_id: uuid(body.requestId),
    });
    return { ...(snapshot as Record<string, unknown>), locks: [] };
  }, true, 201);
}
