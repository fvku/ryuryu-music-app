// Applies only the additive re-import RPC and proves existing rows are unchanged.
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
const migrationFile = path.join(root, 'supabase/migrations/202609110001_generator_reimport.sql');
const sql = await fs.readFile(migrationFile, 'utf8');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const db = new Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 10000 });

async function rows(table) {
  return (await db.query(`select to_jsonb(source) as row from public.${quote(table)} source order by to_jsonb(source)::text`)).rows.map(value => value.row);
}
async function preservedData() {
  const tables = (await db.query("select tablename from pg_tables where schemaname='public' and (left(tablename,3)='pl_' or left(tablename,10)='generator_') order by tablename")).rows;
  const result = {};
  for (const { tablename } of tables) result[tablename] = await rows(tablename);
  return result;
}
async function verifyFunction() {
  const result = await db.query(`select
    to_regprocedure('public.generator_reimport(uuid,text,uuid,jsonb)') is not null as exists,
    has_function_privilege('service_role','public.generator_reimport(uuid,text,uuid,jsonb)','execute') as service_execute,
    has_function_privilege('authenticated','public.generator_reimport(uuid,text,uuid,jsonb)','execute') as authenticated_execute,
    has_function_privilege('anon','public.generator_reimport(uuid,text,uuid,jsonb)','execute') as anon_execute`);
  const value = result.rows[0];
  if (!value.exists || !value.service_execute || value.authenticated_execute || value.anon_execute) throw new Error('Re-import RPC permissions are incorrect');
  return value;
}

try {
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await db.query("SET LOCAL lock_timeout = '5s'"); await db.query("SET LOCAL statement_timeout = '30s'");
  const alreadyApplied = (await db.query("select to_regprocedure('public.generator_reimport(uuid,text,uuid,jsonb)') is not null as applied")).rows[0].applied;
  const before = await preservedData(), beforeHash = sha(before);
  if (!alreadyApplied) {
    const body = sql.replace(/^([\s\S]*?)\bbegin;/i, '$1').replace(/\bcommit;\s*$/i, '');
    await db.query(body);
  }
  const permissions = await verifyFunction(), after = await preservedData();
  if (sha(after) !== beforeHash) throw new Error('Existing playlist or generator data changed');
  await db.query('COMMIT');
  console.log(JSON.stringify({ projectRef: ref, applied: path.basename(migrationFile), alreadyApplied, existingRowsUnchanged: true, permissions }));
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ failed: true, code: error.code || 'CHECK_FAILED', detail: error.code ? undefined : error.message }));
  process.exitCode = 1;
} finally { await db.end(); }
