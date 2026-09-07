// One-project rollout helper. No secrets or playlist rows are printed.
// Uses existing local credentials; never changes or copies the credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prototype = '/Users/koheifukuda/Documents/Claude/Projects/漂流音楽/site/playlist_feature/prototype';
const require = createRequire(`${prototype}/package.json`);
const { Client } = require('pg');
const dotenv = require('dotenv');
const ref = 'jmgpepnycyyjujkrrvwy';
const archiveRoot = path.join(root, '.local/generator-migration-backups');
const migration = path.join(root, 'supabase/migrations/202609040001_generator.sql');
const mode = process.argv[2];
if (!['snapshot', 'apply', 'verify'].includes(mode)) throw new Error('Use snapshot, apply <snapshot.json>, or verify');
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const env = dotenv.parse(await fs.readFile(`${prototype}/.env.local`));
const target = new URL(env.SUPABASE_DB_URL);
if (![target.hostname, decodeURIComponent(target.username)].some(value => value.includes(ref))) throw new Error('Wrong target project');
const sql = await fs.readFile(migration, 'utf8');
const db = new Client({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 10000 });

async function inventory() {
  const tables = (await db.query("select tablename from pg_tables where schemaname='public' and left(tablename,3)='pl_' order by tablename")).rows;
  if (!tables.length) throw new Error('No playlist tables; unexpected database');
  const data = {};
  for (const { tablename } of tables) {
    data[tablename] = (await db.query(`select to_jsonb(t) as row from public.${quote(tablename)} t order by to_jsonb(t)::text`)).rows.map(row => row.row);
  }
  const buckets = (await db.query('select id,name,public,file_size_limit,allowed_mime_types from storage.buckets order by id')).rows;
  const objects = (await db.query('select id,bucket_id,name,metadata,created_at,updated_at from storage.objects order by bucket_id,name')).rows;
  const columns = (await db.query("select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and left(table_name,3)='pl_' order by table_name,ordinal_position")).rows;
  const policies = (await db.query("select * from pg_policies where schemaname='public' and left(tablename,3)='pl_' order by tablename,policyname")).rows;
  const constraints = (await db.query("select c.relname, con.conname, pg_get_constraintdef(con.oid) as definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and left(c.relname,3)='pl_' order by c.relname,con.conname")).rows;
  return { data, buckets, objects, columns, policies, constraints };
}
function summary(contents) {
  return { tables: Object.fromEntries(Object.entries(contents.data).map(([name,rows])=>[name,rows.length])), buckets: contents.buckets.map(b=>({id:b.id,public:b.public})), objects: contents.objects.length };
}
try {
  await db.connect();
  if (mode === 'snapshot') {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout = '30s'");
    const contents = await inventory();
    const snapshot = { projectRef: ref, createdAt: new Date().toISOString(), migrationSha256: sha(sql), contentsSha256: sha(JSON.stringify(contents)), contents,
      limitations: 'Playlist row export and schema/Storage metadata only. Not a pg_dump or a backup of image bytes, Auth, secrets or the complete database. Do not delete original data based solely on this snapshot.' };
    await db.query('ROLLBACK');
    await fs.mkdir(archiveRoot, { recursive: true, mode: 0o700 });
    const file = path.join(archiveRoot, `playlist-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
    const readBack = JSON.parse(await fs.readFile(file, 'utf8'));
    if (sha(JSON.stringify(readBack.contents)) !== snapshot.contentsSha256) throw new Error('Snapshot verification failed');
    console.log(JSON.stringify({ file, sha256: snapshot.contentsSha256, ...summary(contents) }));
  } else if (mode === 'apply') {
    const file = path.resolve(process.argv[3] || '');
    if (!file.startsWith(archiveRoot + path.sep)) throw new Error('Snapshot must be in the private archive directory');
    const snapshot = JSON.parse(await fs.readFile(file, 'utf8'));
    if (snapshot.projectRef !== ref || snapshot.migrationSha256 !== sha(sql) || snapshot.contentsSha256 !== sha(JSON.stringify(snapshot.contents))) throw new Error('Snapshot or migration mismatch');
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '30s'");
    if (sha(JSON.stringify(await inventory())) !== snapshot.contentsSha256) throw new Error('Playlist data changed after snapshot; take a fresh snapshot');
    const existing = await db.query("select tablename from pg_tables where schemaname='public' and left(tablename,10)='generator_'");
    if (existing.rowCount) throw new Error('Generator objects already exist; use verify, not apply');
    const body = sql.replace(/^([\s\S]*?)\bbegin;/i, '$1').replace(/\bcommit;\s*$/i, '');
    await db.query(body);
    if (sha(JSON.stringify(await inventory())) !== snapshot.contentsSha256) throw new Error('Playlist preservation check failed');
    await db.query('COMMIT');
    console.log(JSON.stringify({ applied: path.basename(migration), projectRef: ref, playlistAndStorageMetadataUnchanged: true, migrationSha256: sha(sql) }));
  } else {
    await db.query('BEGIN READ ONLY');
    const tables = (await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and left(c.relname,10)='generator_' order by c.relname")).rows;
    const permissions = (await db.query("select r.role_name, has_table_privilege(r.role_name,'public.generator_documents','select') as table_read, has_function_privilege(r.role_name,'public.generator_read(uuid)','execute') as rpc_read, has_function_privilege(r.role_name,'public.generator_snapshot(uuid)','execute') as internal_read from (values ('anon'),('authenticated'),('service_role')) r(role_name)")).rows;
    console.log(JSON.stringify({ projectRef: ref, tables, permissions, playlist: summary(await inventory()) }));
    await db.query('ROLLBACK');
  }
} catch (error) {
  await db.query('ROLLBACK').catch(()=>{});
  // Do not leak database errors which may contain row contents or connection strings.
  console.error(JSON.stringify({ failed: mode, code: error.code || 'CHECK_FAILED', detail: error.code ? undefined : error.message }));
  process.exitCode = 1;
} finally { await db.end(); }
