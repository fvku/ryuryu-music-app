import { createHash } from "node:crypto";
import { GeneratorError } from "./errors";
import { record, uuid, parseColor, parseItemContent, parseTheme } from "./model";

function invalid(): never { throw new GeneratorError("INVALID_INPUT", 400, "操作の形式・対象・版番号が不正です。"); }
export function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2147483646) invalid();
  return value;
}
function target(raw: Record<string, unknown>, structure: boolean) {
  if (typeof raw.kind !== "string" || !["item", "page", "theme", ...(structure ? ["structure"] : [])].includes(raw.kind)) invalid();
  if (typeof raw.token !== "string" || !/^[0-9a-f]{64}$/.test(raw.token)) invalid();
  return { kind: raw.kind as string, targetId: uuid(raw.targetId), clientId: uuid(raw.clientId),
    tokenHash: createHash("sha256").update(raw.token).digest("hex") };
}
export function parseLock(value: unknown) {
  const raw = record(value, ["action", "kind", "targetId", "clientId", "token", "generation"]);
  if (typeof raw.action !== "string" || !["acquire", "heartbeat", "release", "transfer"].includes(raw.action)) invalid();
  return { action: raw.action as string, lock: { ...target(raw, true),
    ...(["heartbeat", "release"].includes(raw.action as string) ? { generation: version(raw.generation) } : {}) } };
}
export function parseChange(value: unknown) {
  const raw = record(value, ["requestId", "kind", "targetId", "clientId", "token", "generation", "expectedVersion", "content", "restoreVersion"]);
  const base = { ...target(raw, true), generation: version(raw.generation), expectedVersion: version(raw.expectedVersion) };
  const requestId = uuid(raw.requestId);
  if (raw.restoreVersion !== undefined) {
    if (raw.content !== undefined) invalid();
    return { requestId, change: { ...base, restoreVersion: version(raw.restoreVersion) } };
  }
  let content;
  if (base.kind === "item") content = parseItemContent(raw.content);
  else if (base.kind === "theme") content = parseTheme(raw.content);
  else if (base.kind === "structure") {
    const data = record(raw.content, ["pages"]);
    if (!Array.isArray(data.pages) || data.pages.length < 1 || data.pages.length > 200) invalid();
    const pageIds = new Set<string>(), itemIds = new Set<string>();
    content = { pages: data.pages.map(value => {
      const page = record(value, ["id", "itemIds"]), id = uuid(page.id);
      if (pageIds.has(id) || !Array.isArray(page.itemIds) || page.itemIds.length < 1 || page.itemIds.length > 2) invalid();
      pageIds.add(id);
      return { id, itemIds: page.itemIds.map(value => { const id = uuid(value); if (itemIds.has(id)) invalid(); itemIds.add(id); return id; }) };
    }) };
  }
  else { const data = record(raw.content, ["bgColor"]); content = { bgColor: parseColor(data.bgColor) }; }
  return { requestId, change: { ...base, content } };
}
