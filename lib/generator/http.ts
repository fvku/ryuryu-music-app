import "server-only";
import { auth } from "../auth";
import { generatorActor, checkOrigin, readBody } from "./access";
import { GeneratorError } from "./errors";

export async function generatorHandler(request: Request, action: (actor: string, body: unknown) => Promise<unknown>, write = false, status = 200): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  try {
    const actor = generatorActor(await auth());
    if (write) checkOrigin(request);
    const result = await action(actor, write ? await readBody(request) : undefined);
    return Response.json(result, { status, headers });
  } catch (error) {
    const known = error instanceof GeneratorError ? error : new GeneratorError("INTERNAL_ERROR", 500, "操作に失敗しました。");
    return Response.json({ error: known.message, code: known.code }, { status: known.status, headers });
  }
}
