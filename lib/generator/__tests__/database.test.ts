import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { fixture } from "./fixture";
import { parseDocument } from "../model";

let db: PGlite;
let doc: ReturnType<typeof fixture>;
type Snapshot = { document: ReturnType<typeof fixture>; version: number; itemVersions: Record<string, number>; pageVersions: Record<string, number>; themeVersion: number; structureVersion: number };
type Lock = { kind: string; targetId: string; clientId: string; tokenHash: string; generation: number };
const actor = "member-a@example.com";
async function query<T>(sql: string, args: unknown[] = []): Promise<T> { return (await db.query<{ result: T }>(sql, args)).rows[0]?.result; }
const read = () => query<Snapshot>("select public.generator_read($1) as result", [doc.id]);
async function acquire(kind: string, targetId: string, owner = actor): Promise<Lock> {
  const lock = { kind, targetId, clientId: randomUUID(), tokenHash: randomUUID().replaceAll("-", "").repeat(2), generation: 0 };
  const result = await query<{ generation: number }>("select public.generator_lock($1,$2,'acquire',$3) as result", [doc.id, owner, lock]);
  return { ...lock, generation: result.generation };
}
function save(lock: Lock, content: unknown, owner = actor, expectedVersion = 1, requestId = randomUUID()) {
  return query<Snapshot>("select public.generator_save($1,$2,$3,$4) as result", [doc.id, owner, requestId, { ...lock, expectedVersion, content }]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(await readFile(new URL("../../../supabase/migrations/202609040001_generator.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../../supabase/migrations/202609050001_generator_completion.sql", import.meta.url), "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("reset role; truncate public.generator_documents cascade;");
  doc = parseDocument(fixture());
  await query("select public.generator_create($1,$2,$3) as result", [doc, actor, randomUUID()]);
});
afterAll(async () => { await db?.close(); });

describe("generator database transaction contract (embedded PostgreSQL)", () => {
  it("creates the full snapshot, keeps source/formatting, and starts one history revision", async () => {
    const result = await read();
    expect(result.version).toBe(1);
    expect(result.document.items).toEqual(expect.arrayContaining(doc.items));
    expect(result.document.pages).toEqual(doc.pages);
    const history = await query<unknown[]>("select public.generator_history($1) as result", [doc.id]);
    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain("tokenHash");
  });
  it("keeps three independent item saves even when their document versions are stale", async () => {
    const owners = [actor, "member-b@example.com", "member-c@example.com"];
    const locks = await Promise.all(doc.items.map((item, i) => acquire("item", item.id, owners[i])));
    await Promise.all(locks.map((lock, i) => save(lock, { ...doc.items[i].content, fields: { ...doc.items[i].content.fields, title: `edited ${i}` } }, owners[i])));
    const result = await read();
    expect(result.version).toBe(4);
    for (let i = 0; i < 3; i++) expect(result.document.items.find(item => item.id === doc.items[i].id)?.content.fields.title).toBe(`edited ${i}`);
    expect(Object.values(result.itemVersions)).toEqual([2, 2, 2]);
  });
  it("lets two listed items and their shared page color save independently", async () => {
    const page = doc.pages[1];
    const upper = await acquire("item", doc.items[1].id), lower = await acquire("item", doc.items[2].id, "b@example.com");
    const bg = await acquire("page", page.id, "c@example.com");
    await save(upper, { ...doc.items[1].content, tracking: -.01 });
    await save(lower, { ...doc.items[2].content, bodyMaxLead: 50 }, "b@example.com");
    await save(bg, { bgColor: "#654321" }, "c@example.com");
    const result = await read();
    expect(result.document.pages[1].bgColor).toBe("#654321");
    expect(result.pageVersions[page.id]).toBe(2);
    expect(result.document.items.find(item => item.id === doc.items[1].id)?.content.tracking).toBe(-.01);
    expect(result.document.items.find(item => item.id === doc.items[2].id)?.content.bodyMaxLead).toBe(50);
  });
  it("rejects another editor and stale item versions", async () => {
    const lock = await acquire("item", doc.items[0].id);
    await expect(acquire("item", doc.items[0].id, "other@example.com")).rejects.toThrow("LOCK_CONFLICT");
    await expect(save(lock, doc.items[0].content, "other@example.com")).rejects.toThrow("LOCK_LOST");
    await save(lock, doc.items[0].content);
    await expect(save(lock, doc.items[0].content)).rejects.toThrow("VERSION_CONFLICT");
    expect((await read()).version).toBe(2);
  });
  it("does not resurrect expired locks, and increments their generation on reacquire", async () => {
    const lock = await acquire("item", doc.items[0].id);
    await db.query("update public.generator_locks set expires_at = clock_timestamp() - interval '1 second' where document_id = $1", [doc.id]);
    await expect(query("select public.generator_lock($1,$2,'heartbeat',$3) as result", [doc.id, actor, lock])).rejects.toThrow("LOCK_LOST");
    await expect(save(lock, doc.items[0].content)).rejects.toThrow("LOCK_LOST");
    const next = await acquire("item", doc.items[0].id);
    expect(next.generation).toBe(2);
    await expect(query("select public.generator_lock($1,$2,'release',$3) as result", [doc.id, actor, lock])).rejects.toThrow("LOCK_LOST");
  });
  it("allows explicit same-person device transfer but fences the old device", async () => {
    const old = await acquire("item", doc.items[0].id);
    const next = { ...old, clientId: randomUUID(), tokenHash: "b".repeat(64) };
    await expect(query("select public.generator_lock($1,$2,'transfer',$3) as result", [doc.id, "other@example.com", next])).rejects.toThrow("LOCK_CONFLICT");
    const result = await query<{ generation: number }>("select public.generator_lock($1,$2,'transfer',$3) as result", [doc.id, actor, next]);
    expect(result.generation).toBe(2);
    await expect(save(old, doc.items[0].content)).rejects.toThrow("LOCK_LOST");
    await save({ ...next, generation: 2 }, doc.items[0].content);
  });
  it("replays a saved request once even after lock release, but rejects different payload reuse", async () => {
    const lock = await acquire("item", doc.items[0].id), requestId = randomUUID();
    const first = await save(lock, doc.items[0].content, actor, 1, requestId);
    await query("select public.generator_lock($1,$2,'release',$3) as result", [doc.id, actor, lock]);
    expect(await save(lock, doc.items[0].content, actor, 1, requestId)).toEqual(first);
    await expect(save(lock, { ...doc.items[0].content, bodyMaxLead: 50 }, actor, 1, requestId)).rejects.toThrow("REQUEST_CONFLICT");
    expect((await read()).version).toBe(2);
  });
  it("restores only an item as a new revision, preserving other items and colors", async () => {
    const item = await acquire("item", doc.items[0].id), bg = await acquire("page", doc.pages[0].id);
    await save(item, { ...doc.items[0].content, fields: { ...doc.items[0].content.fields, title: "changed" } });
    await save(bg, { bgColor: "#fedcba" });
    const result = await query<Snapshot>("select public.generator_save($1,$2,$3,$4) as result", [doc.id, actor, randomUUID(), { ...item, expectedVersion: 2, restoreVersion: 1 }]);
    expect(result.version).toBe(4); expect(result.itemVersions[item.targetId]).toBe(3);
    expect(result.document.items.find(slot => slot.id === item.targetId)?.content).toEqual(doc.items[0].content);
    expect(result.document.pages[0].bgColor).toBe("#fedcba");
  });
  it("rolls back the entire save/history when an asset is pending, missing or foreign", async () => {
    const lock = await acquire("item", doc.items[0].id);
    await expect(save(lock, { ...doc.items[0].content, jacketAssetId: randomUUID() })).rejects.toThrow("ASSET_NOT_READY");
    const asset = randomUUID();
    await db.query("insert into public.generator_assets values ($1,$2,$3,'pending','image/png',100,10,10,$4,$5,now())", [doc.id, asset, `${doc.id}/${asset}.png`, "a".repeat(64), actor]);
    await expect(save(lock, { ...doc.items[0].content, jacketAssetId: asset })).rejects.toThrow("ASSET_NOT_READY");
    const foreign = fixture(); foreign.period = { type: "month", start: "2026-09-01", end: "2026-10-01" };
    await query("select public.generator_create($1,$2,$3) as result", [foreign, actor, randomUUID()]);
    await db.query("update public.generator_assets set document_id = $1, status = 'ready' where id = $2", [foreign.id, asset]);
    await expect(save(lock, { ...doc.items[0].content, jacketAssetId: asset })).rejects.toThrow("ASSET_NOT_READY");
    expect((await read()).version).toBe(1);
    expect(await query<unknown[]>("select public.generator_history($1) as result", [doc.id])).toHaveLength(1);
    await db.query("update public.generator_assets set document_id = $1 where id = $2", [doc.id, asset]);
    expect((await save(lock, { ...doc.items[0].content, jacketAssetId: asset })).version).toBe(2);
  });
  it("rolls back item and document writes when history insertion fails", async () => {
    const lock = await acquire("item", doc.items[0].id);
    await db.exec("create function public.test_history_failure() returns trigger language plpgsql as $$ begin raise exception 'INJECTED_FAILURE'; end; $$; create trigger test_history_failure before insert on public.generator_revisions for each row execute function public.test_history_failure();");
    try {
      await expect(save(lock, { ...doc.items[0].content, bodyMaxLead: 55 })).rejects.toThrow("INJECTED_FAILURE");
      const result = await read(); expect(result.version).toBe(1);
      expect(result.itemVersions[doc.items[0].id]).toBe(1);
      expect(result.document.items.find(item => item.id === doc.items[0].id)?.content.bodyMaxLead).toBe(42);
    } finally { await db.exec("drop trigger test_history_failure on public.generator_revisions; drop function public.test_history_failure();"); }
  });
  it.each(["page", "theme"])("restores %s settings without reverting later item edits", async kind => {
    const targetId = kind === "page" ? doc.pages[0].id : doc.id;
    const lock = await acquire(kind, targetId), item = await acquire("item", doc.items[0].id);
    await save(lock, kind === "page" ? { bgColor: "#555555" } : { ...doc.theme, useWave: false, outputSize: 1200 });
    await save(item, { ...doc.items[0].content, bodyMaxLead: 60 });
    const result = await query<Snapshot>("select public.generator_save($1,$2,$3,$4) as result", [doc.id, actor, randomUUID(), { ...lock, expectedVersion: 2, restoreVersion: 1 }]);
    expect(result.document.items.find(slot => slot.id === item.targetId)?.content.bodyMaxLead).toBe(60);
    expect(kind === "page" ? result.document.pages[0].bgColor : result.document.theme).toEqual(kind === "page" ? doc.pages[0].bgColor : doc.theme);
  });
  it("retries acquisition without renewal, and publishes owner state without secrets", async () => {
    const lock = await acquire("item", doc.items[0].id);
    const first = await query("select public.generator_lock($1,$2,'acquire',$3) as result", [doc.id, actor, lock]);
    expect(await query("select public.generator_lock($1,$2,'acquire',$3) as result", [doc.id, actor, lock])).toEqual(first);
    const snapshot = await read();
    expect(snapshot).toHaveProperty("locks", [expect.objectContaining({ kind: "item", targetId: lock.targetId, owner: actor })]);
    expect(JSON.stringify(snapshot)).not.toContain(lock.tokenHash);
  });
  it("conflicts structure edits with page color locks, not with unrelated item edits", async () => {
    const page = await acquire("page", doc.pages[0].id);
    await expect(acquire("structure", doc.id)).rejects.toThrow("LOCK_CONFLICT");
    await acquire("item", doc.items[0].id, "b@example.com");
    await query("select public.generator_lock($1,$2,'release',$3) as result", [doc.id, actor, page]);
    await acquire("structure", doc.id);
    await expect(acquire("page", doc.pages[1].id)).rejects.toThrow("LOCK_CONFLICT");
  });
  it("saves and restores ordering without reverting page colors or item edits", async () => {
    const structure = await acquire("structure", doc.id);
    const content = { pages: doc.pages.map(page => ({ id: page.id, itemIds: page.kind === "listed" ? [...page.itemIds].reverse() : page.itemIds })) };
    const moved = await query<Snapshot>("select public.generator_structure_save($1,$2,$3,$4) as result", [doc.id, actor, randomUUID(), { ...structure, expectedVersion: 1, content }]);
    expect(moved.structureVersion).toBe(2);
    expect(moved.document.pages[1].itemIds).toEqual([...doc.pages[1].itemIds].reverse());
    await query("select public.generator_lock($1,$2,'release',$3) as result", [doc.id, actor, structure]);
    const page = await acquire("page", doc.pages[1].id), item = await acquire("item", doc.items[1].id);
    await save(page, { bgColor: "#654321" });
    await save(item, { ...doc.items[1].content, fields: { ...doc.items[1].content.fields, title: "kept" } });
    await query("select public.generator_lock($1,$2,'release',$3) as result", [doc.id, actor, page]);
    const restoreLock = await acquire("structure", doc.id);
    const restored = await query<Snapshot>("select public.generator_structure_save($1,$2,$3,$4) as result", [doc.id, actor, randomUUID(), { ...restoreLock, expectedVersion: 2, restoreVersion: 1 }]);
    expect(restored.document.pages[1].itemIds).toEqual(doc.pages[1].itemIds);
    expect(restored.document.pages[1].bgColor).toBe("#654321");
    expect(restored.document.items.find(value => value.id === doc.items[1].id)?.content.fields.title).toBe("kept");
  });
  it("registers an uploaded asset only while its item lock remains valid", async () => {
    const lock = await acquire("item", doc.items[0].id), id = randomUUID(), sha = "a".repeat(64);
    const asset = { id, mimeType: "image/png", bytes: 100, width: 10, height: 10, sha256: sha };
    const prepared = await query<{ path: string; status: string }>("select public.generator_asset_prepare($1,$2,$3,$4) as result", [doc.id, actor, asset, lock]);
    expect(prepared).toEqual({ path: `${doc.id}/${id}.png`, status: "pending", id });
    await expect(query("select public.generator_asset_read($1,$2) as result", [doc.id, id])).rejects.toThrow("NOT_FOUND");
    await db.query("update public.generator_locks set expires_at = clock_timestamp() - interval '1 second' where document_id = $1 and target_id = $2", [doc.id, lock.targetId]);
    await expect(query("select public.generator_asset_ready($1,$2,$3,$4,$5) as result", [doc.id, actor, id, sha, lock])).rejects.toThrow("LOCK_LOST");
    const active = await acquire("item", doc.items[0].id);
    const ready = await query<{ mimeType: string }>("select public.generator_asset_ready($1,$2,$3,$4,$5) as result", [doc.id, actor, id, sha, active]);
    expect(ready.mimeType).toBe("image/png");
    expect(await query("select public.generator_asset_read($1,$2) as result", [doc.id, id])).toEqual(expect.objectContaining({ id, path: `${doc.id}/${id}.png` }));
  });
  it("denies table reads and RPC execution to public clients, while server role can use only public RPCs", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from public.generator_documents")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.generator_snapshot($1)", [doc.id])).rejects.toThrow(/permission denied/);
      if (role === "service_role") expect((await read()).version).toBe(1);
      else await expect(read()).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    const enabled = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname like 'generator_%' and relkind = 'r'");
    expect(enabled.rows).toHaveLength(5); expect(enabled.rows.every(row => row.relrowsecurity)).toBe(true);
  });
  it("creates idempotently and rejects duplicate periods without creating orphan data", async () => {
    const another = fixture(); another.period = { type: "month", start: "2026-09-01", end: "2026-10-01" };
    const request = randomUUID();
    const first = await query("select public.generator_create($1,$2,$3) as result", [another, actor, request]);
    expect(await query("select public.generator_create($1,$2,$3) as result", [another, actor, request])).toEqual(first);
    const collision = { ...another, id: randomUUID() };
    await expect(query("select public.generator_create($1,$2,$3) as result", [collision, actor, randomUUID()])).rejects.toThrow(/unique constraint/);
  });
});
