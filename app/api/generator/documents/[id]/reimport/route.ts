import { generatorHandler } from "@/lib/generator/http";
import { uuid, parseDocument } from "@/lib/generator/model";
import { parseReimport } from "@/lib/generator/commands";
import { generatorRpc } from "@/lib/generator/repository";
import { readGeneratorReleaseMaster } from "@/lib/generator/release-master";
import { buildReimport, collectReimportDiff } from "@/lib/generator/reimport";
import type { GeneratorSnapshot } from "@/lib/generator/client-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return generatorHandler(request, async () => {
    const id = uuid((await context.params).id);
    const [raw, albums] = await Promise.all([generatorRpc("generator_read", { p_id: id }), readGeneratorReleaseMaster()]);
    const snapshot = raw as GeneratorSnapshot;
    return collectReimportDiff(parseDocument(snapshot.document), albums);
  });
}

export function POST(request: Request, context: Context) {
  return generatorHandler(request, async (actor, body) => {
    const id = uuid((await context.params).id), command = parseReimport(body);
    const [raw, albums] = await Promise.all([generatorRpc("generator_read", { p_id: id }), readGeneratorReleaseMaster()]);
    const snapshot = raw as GeneratorSnapshot, document = parseDocument(snapshot.document);
    const proposal = buildReimport({ document, albums, addKeys: command.addKeys, removeItemIds: command.removeItemIds, resort: command.resort });
    return generatorRpc("generator_reimport", {
      p_id: id, p_actor: actor, p_request_id: command.requestId,
      p_change: {
        kind: "structure", targetId: id, clientId: command.clientId, tokenHash: command.tokenHash,
        generation: command.generation, expectedVersion: command.expectedVersion,
        expectedItemVersions: snapshot.itemVersions, pages: proposal.pages,
        addItems: proposal.addItems, removeItemIds: proposal.removeItemIds,
      },
    });
  }, true);
}
