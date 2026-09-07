import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture";
import { parseDocument, parseItemContent, parseTheme, type ItemContent } from "../model";
import { parseChange, parseLock } from "../commands";

describe("shared document format", () => {
  it("round-trips all fields/typography, source identity, explicit newlines, and separate pages", () => {
    const original = fixture(); original.items[0].source.uid = "RM-uid-123";
    const result = parseDocument(JSON.parse(JSON.stringify(original)));
    expect(result).toEqual(original);
    result.items[0].content.typography.title!.kerns[0] = .1;
    expect(original.items[0].content.typography.title!.kerns[0]).toBe(.01);
  });
  it("supports leap months and explicit cross-year seven-day periods without inventing week boundaries", () => {
    const doc = fixture(); doc.period = { type: "month", start: "2028-02-01", end: "2028-03-01" };
    expect(parseDocument(doc).period).toEqual(doc.period);
    doc.series = "weekly"; doc.rendererVersion = null;
    doc.period = { type: "week", start: "2026-12-29", end: "2027-01-05" };
    expect(parseDocument(doc).period).toEqual(doc.period);
  });
  it("keeps an odd final listed page without an invented second item", () => {
    const doc = fixture(); doc.items.pop(); doc.pages[1].itemIds.pop();
    expect(parseDocument(doc).pages[1].itemIds).toHaveLength(1);
  });
  it("treats documents saved before the automatic lead mode as automatic", () => {
    const content = structuredClone(fixture().items[0].content) as Partial<ItemContent>;
    delete content.bodyLeadMode;
    expect(parseItemContent(content).bodyLeadMode).toBe("auto");
  });
  it.each([
    ["duplicate item", (doc: ReturnType<typeof fixture>) => { doc.items[1].id = doc.items[0].id; }],
    ["duplicate placement", (doc: ReturnType<typeof fixture>) => { doc.pages[1].itemIds[0] = doc.pages[0].itemIds[0]; }],
    ["unplaced item", (doc: ReturnType<typeof fixture>) => { doc.pages.pop(); }],
    ["dangling item", (doc: ReturnType<typeof fixture>) => { doc.pages[0].itemIds[0] = randomUUID(); }],
    ["duplicate page", (doc: ReturnType<typeof fixture>) => { doc.pages[1].id = doc.pages[0].id; }],
    ["duplicate UID", (doc: ReturnType<typeof fixture>) => { doc.items[0].source.uid = "uid"; doc.items[1].source.uid = "uid"; }],
    ["wrong month end", (doc: ReturnType<typeof fixture>) => { doc.period.end = "2026-09-02"; }],
    ["invalid calendar date", (doc: ReturnType<typeof fixture>) => { doc.period.start = "2026-02-30"; }],
    ["unsupported output", (doc: ReturnType<typeof fixture>) => { Object.assign(doc.theme, { outputSize: 9600 }); }],
    ["future format", (doc: ReturnType<typeof fixture>) => { Object.assign(doc, { schemaVersion: 999 }); }],
    ["array discriminator", (doc: ReturnType<typeof fixture>) => { Object.assign(doc, { series: ["monthly"] }); }],
    ["array page kind", (doc: ReturnType<typeof fixture>) => { Object.assign(doc.pages[0], { kind: ["adopted"] }); }],
    ["reversed grouping", (doc: ReturnType<typeof fixture>) => { doc.pages.reverse(); }],
    ["ephemeral image URL", (doc: ReturnType<typeof fixture>) => { doc.items[0].content.jacketAssetId = "blob:temporary"; }],
    ["out of range kern", (doc: ReturnType<typeof fixture>) => { doc.items[0].content.kerns = { 99999: .01 }; }],
    ["client metadata injection", (doc: ReturnType<typeof fixture>) => { Object.assign(doc, { updatedBy: "someone@example.com" }); }],
    ["raw source credentials", (doc: ReturnType<typeof fixture>) => { Object.assign(doc.items[0].source, { token: "not-allowed" }); }],
    ["insecure source image", (doc: ReturnType<typeof fixture>) => { doc.items[0].source.coverUrl = "http://example.com/cover.jpg"; }],
  ])("rejects %s", (_, mutate) => {
    const doc = fixture(); mutate(doc); const before = structuredClone(doc);
    expect(() => parseDocument(doc)).toThrow(); expect(doc).toEqual(before);
  });
  it("requires persistent asset IDs and never accepts UI state/Images in content", () => {
    const content = fixture().items[0].content;
    expect(() => parseItemContent({ ...content, selection: [1, 2] })).toThrow();
    expect(() => parseTheme({ useWave: true, waveAssetId: "https://signed.invalid", backgroundAssetId: null, outputSize: 2400 })).toThrow();
  });
});

describe("target commands", () => {
  const lock = { kind: "item", targetId: randomUUID(), clientId: randomUUID(), token: "a".repeat(64), generation: 1 };
  it("hashes the client secret before calling the DB", () => {
    const result = parseLock({ ...lock, action: "heartbeat" });
    expect(result.lock.tokenHash).toHaveLength(64); expect(JSON.stringify(result)).not.toContain(lock.token);
  });
  it("accepts only target content updates and keeps actor out of user input", () => {
    const change = { ...lock, requestId: randomUUID(), expectedVersion: 1, content: fixture().items[0].content };
    expect(parseChange(change).change.kind).toBe("item");
    expect(() => parseChange({ ...change, actor: "someone@example.com" })).toThrow();
    expect(() => parseChange({ ...change, generation: 0 })).toThrow();
    expect(() => parseChange({ ...change, expectedVersion: "1" })).toThrow();
    expect(() => parseLock({ ...lock, action: ["acquire"] })).toThrow();
  });
  it("restores a specific revision without accepting a client-supplied replacement snapshot", () => {
    const change = { ...lock, requestId: randomUUID(), expectedVersion: 2, restoreVersion: 1 };
    expect(parseChange(change).change).toHaveProperty("restoreVersion", 1);
    expect(() => parseChange({ ...change, content: fixture().items[0].content })).toThrow();
  });
  it("accepts only a complete, duplicate-free structure ordering", () => {
    const doc = fixture(), structure = { kind: "structure", targetId: doc.id, clientId: randomUUID(), token: "b".repeat(64), generation: 1,
      requestId: randomUUID(), expectedVersion: 1, content: { pages: doc.pages.map(page => ({ id: page.id, itemIds: page.itemIds })) } };
    expect(parseChange(structure).change.kind).toBe("structure");
    expect(() => parseChange({ ...structure, content: { pages: [{ id: doc.pages[0].id, itemIds: [doc.items[0].id, doc.items[0].id] }] } })).toThrow();
  });
});
