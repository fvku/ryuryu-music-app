// Live database test: all synthetic writes occur inside one rolled-back transaction.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture } from '../../lib/generator/__tests__/fixture.ts';

const prototype = '/Users/koheifukuda/Documents/Claude/Projects/漂流音楽/site/playlist_feature/prototype';
const require = createRequire(`${prototype}/package.json`);
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const env = require('dotenv').parse(await fs.readFile(`${prototype}/.env.local`));
const url = new URL(env.SUPABASE_DB_URL);
const ref = 'jmgpepnycyyjujkrrvwy';
assert([url.hostname, decodeURIComponent(url.username)].some(x => x.includes(ref)));
const db = new Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 10000 });
const document = fixture();
document.period = { type: 'month', start: '2099-01-01', end: '2099-02-01' };
let stage = 'connect';
async function rpc(name: string, values: unknown[]) {
  assert(['generator_create', 'generator_lock', 'generator_save', 'generator_structure_save', 'generator_reimport', 'generator_asset_prepare', 'generator_asset_ready', 'generator_asset_read', 'generator_read'].includes(name));
  return (await db.query(`select public.${name}(${values.map((_, i) => `$${i+1}`).join(',')}) as result`, values)).rows[0].result;
}
try {
  await db.connect();
  stage = 'transaction';
  await db.query('BEGIN');
  await db.query("SET LOCAL statement_timeout = '15s'");
  await db.query("SET LOCAL lock_timeout = '5s'");
  await db.query('SET LOCAL ROLE service_role');
  const actor = 'rollout-check@example.invalid';
  stage = 'create-save-restore';
  await rpc('generator_create', [document, actor, randomUUID()]);
  const locks = [];
  for (let i = 0; i < 3; i++) {
    const lock = { kind: 'item', targetId: document.items[i].id, clientId: randomUUID(), tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex') };
    const acquired = await rpc('generator_lock', [document.id, actor, 'acquire', lock]);
    locks.push({ ...lock, generation: acquired.generation });
    const content = structuredClone(document.items[i].content);
    content.fields.title = `Live smoke item ${i}`;
    await rpc('generator_save', [document.id, actor, randomUUID(), { ...locks[i], expectedVersion: 1, content }]);
  }
  let saved = await rpc('generator_read', [document.id]);
  for (let i = 0; i < 3; i++) assert.equal(saved.document.items.find((item: {id:string}) => item.id === document.items[i].id).content.fields.title, `Live smoke item ${i}`);
  await rpc('generator_save', [document.id, actor, randomUUID(), { ...locks[0], expectedVersion: 2, restoreVersion: 1 }]);
  saved = await rpc('generator_read', [document.id]);
  assert.equal(saved.document.items.find((item: {id:string}) => item.id === document.items[0].id).content.fields.title, document.items[0].content.fields.title);
  assert.equal(saved.document.items.find((item: {id:string}) => item.id === document.items[1].id).content.fields.title, 'Live smoke item 1');
  const structureSeed = { kind: 'structure', targetId: document.id, clientId: randomUUID(), tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex') };
  stage = 'structure-save';
  const structureLock = { ...structureSeed, generation: (await rpc('generator_lock', [document.id, actor, 'acquire', structureSeed])).generation };
  const pages = document.pages.map(page => ({ id: page.id, itemIds: page.kind === 'listed' ? [...page.itemIds].reverse() : page.itemIds }));
  saved = await rpc('generator_structure_save', [document.id, actor, randomUUID(), { ...structureLock, expectedVersion: 1, content: { pages } }]);
  assert.equal(saved.structureVersion, 2);
  assert.deepEqual(saved.document.pages[1].itemIds, [...document.pages[1].itemIds].reverse());
  const added = structuredClone(document.items[2]);
  stage = 'reimport';
  added.id = randomUUID(); added.source.no = 'reimport-smoke'; added.content.fields.title = 'Live re-import item';
  const reimportPages = saved.document.pages.map((page: {id:string;kind:string;itemIds:string[];bgColor:string|null}) => page.kind === 'listed'
    ? { ...page, itemIds: [document.items[1].id, added.id] }
    : page);
  // The UI returns its own lock before deleting an item; foreign active locks remain a hard conflict.
  await rpc('generator_lock', [document.id, actor, 'release', locks[2]]);
  saved = await rpc('generator_reimport', [document.id, actor, randomUUID(), {
    ...structureLock, expectedVersion: 2, expectedItemVersions: saved.itemVersions,
    pages: reimportPages, addItems: [added], removeItemIds: [document.items[2].id],
  }]);
  assert.equal(saved.structureVersion, 3);
  assert.equal(saved.document.items.some((item: {id:string}) => item.id === document.items[2].id), false);
  assert.equal(saved.document.items.find((item: {id:string}) => item.id === added.id).content.fields.title, 'Live re-import item');
  const assetId = randomUUID(), sha256 = 'a'.repeat(64), asset = { id: assetId, mimeType: 'image/png', bytes: 100, width: 10, height: 10, sha256 };
  stage = 'asset-lifecycle';
  const prepared = await rpc('generator_asset_prepare', [document.id, actor, asset, locks[0]]);
  assert.equal(prepared.path, `${document.id}/${assetId}.png`);
  await rpc('generator_asset_ready', [document.id, actor, assetId, sha256, locks[0]]);
  assert.equal((await rpc('generator_asset_read', [document.id, assetId])).mimeType, 'image/png');
  await db.query('ROLLBACK');
  stage = 'rollback-verification';
  assert.equal((await db.query('select count(*)::int as count from public.generator_documents where id=$1', [document.id])).rows[0].count, 0);
  const policies = (await db.query("select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname")).rows;
  console.log(JSON.stringify({ liveCreateSaveRestoreStructureReimportAndAssetLifecyclePassed: true, syntheticDataRolledBack: true, storagePolicies: policies }));
  const storage = createClient(`https://${ref}.supabase.co`, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from('generator-assets');
  stage = 'storage-smoke';
  const storagePath = `_smoke/${randomUUID()}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  try {
    const uploaded = await storage.upload(storagePath, png, { contentType: 'image/png', upsert: false });
    assert.equal(uploaded.error, null);
    const downloaded = await storage.download(storagePath);
    assert.equal(downloaded.error, null); assert.deepEqual(Buffer.from(await downloaded.data.arrayBuffer()), png);
  } finally {
    const removed = await storage.remove([storagePath]); assert.equal(removed.error, null);
  }
  console.log(JSON.stringify({ privateStorageUploadDownloadCleanupPassed: true }));
  // Real PostgREST read using existing server credential; no synthetic rows sent over HTTP.
  stage = 'postgrest-read';
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/generator_read`, {
    method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: null }), signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  assert.equal(response.status, 200);
  assert(Array.isArray(await response.json()));
  console.log(JSON.stringify({ postgrestReadPassed: true }));
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  const value = error as {code?:string;message?:string};
  const safeMessages = new Set(['NOT_FOUND', 'INVALID_INPUT', 'REQUEST_CONFLICT', 'LOCK_LOST', 'LOCK_CONFLICT', 'VERSION_CONFLICT', 'ASSET_NOT_READY']);
  console.error(JSON.stringify({ liveSmokeFailed: true, stage, code: value.code || 'CHECK_FAILED', detail: safeMessages.has(value.message || '') ? value.message : undefined }));
  process.exitCode = 1;
} finally { await db.end(); }
