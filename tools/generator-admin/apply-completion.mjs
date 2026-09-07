// Applies the additive generator completion migration to the already-reused project.
// It hashes playlist rows and pre-existing generator data before/after in one transaction.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prototype = '/Users/koheifukuda/Documents/Claude/Projects/漂流音楽/site/playlist_feature/prototype';
const require = createRequire(`${prototype}/package.json`);
const { Client } = require('pg'), dotenv = require('dotenv');
const ref = 'jmgpepnycyyjujkrrvwy';
const env = dotenv.parse(await fs.readFile(`${prototype}/.env.local`));
const target = new URL(env.SUPABASE_DB_URL);
if (![target.hostname, decodeURIComponent(target.username)].some(value => value.includes(ref))) throw new Error('Wrong target project');
const migrationFile = path.join(root, 'supabase/migrations/202609050001_generator_completion.sql');
const sql = await fs.readFile(migrationFile, 'utf8');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const db = new Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 10000 });

async function rows(table, columns = '*') {
  return (await db.query(`select to_jsonb(source) as row from (select ${columns} from public.${quote(table)}) source order by to_jsonb(source)::text`)).rows.map(value => value.row);
}
async function preservedData() {
  const playlists = (await db.query("select tablename from pg_tables where schemaname='public' and left(tablename,3)='pl_' order by tablename")).rows;
  const playlistRows = {};
  for (const { tablename } of playlists) playlistRows[tablename] = await rows(tablename);
  const generator = {
    documents: await rows('generator_documents', 'id,series,period_start,period_end,data,version,theme_version,page_versions,created_by,updated_by,updated_at'),
    items: await rows('generator_items'), locks: await rows('generator_locks'), revisions: await rows('generator_revisions'), assets: await rows('generator_assets'),
  };
  return { playlistRows, generator };
}

try {
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await db.query("SET LOCAL lock_timeout = '5s'"); await db.query("SET LOCAL statement_timeout = '30s'");
  const exists = (await db.query("select 1 from information_schema.columns where table_schema='public' and table_name='generator_documents' and column_name='structure_version'")).rowCount > 0;
  if (exists) {
    const functions = (await db.query("select proname from pg_proc join pg_namespace on pg_namespace.oid=pg_proc.pronamespace where nspname='public' and proname in ('generator_structure_save','generator_asset_prepare','generator_asset_ready','generator_asset_read') order by proname")).rows.map(value => value.proname);
    await db.query('ROLLBACK');
    if (functions.length !== 4) throw new Error('Completion migration is partially applied');
    console.log(JSON.stringify({ projectRef: ref, alreadyApplied: true, functions }));
  } else {
    const before = await preservedData(), beforeHash = sha(before);
    const body = sql.replace(/^([\s\S]*?)\bbegin;/i, '$1').replace(/\bcommit;\s*$/i, '');
    await db.query(body);
    const after = await preservedData();
    if (sha(after) !== beforeHash) throw new Error('Existing playlist or generator data changed');
    await db.query('COMMIT');
    console.log(JSON.stringify({ projectRef: ref, applied: path.basename(migrationFile), existingDataUnchanged: true,
      playlistTables: Object.keys(before.playlistRows).length, generatorDocuments: before.generator.documents.length }));
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ failed: true, code: error.code || 'CHECK_FAILED', detail: error.code ? undefined : error.message }));
  process.exitCode = 1;
} finally { await db.end(); }
