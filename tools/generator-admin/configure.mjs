import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prototype = '/Users/koheifukuda/Documents/Claude/Projects/漂流音楽/site/playlist_feature/prototype';
const require = createRequire(`${prototype}/package.json`);
const dotenv = require('dotenv');
const source = dotenv.parse(await fs.readFile(`${prototype}/.env.local`));
const url = 'https://jmgpepnycyyjujkrrvwy.supabase.co';
assert.equal(source.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ''), url);
assert(source.SUPABASE_SERVICE_ROLE_KEY);

try {
  if (process.argv[2] === 'storage') {
    const { createClient } = require('@supabase/supabase-js');
    const client = createClient(url, source.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000), redirect: 'error' }) } });
    const name = 'generator-assets';
    const before = await client.storage.listBuckets();
    if (before.error) throw new Error('Cannot read bucket metadata');
    if (!before.data.some(bucket => bucket.id === name)) {
      const created = await client.storage.createBucket(name, { public: false, fileSizeLimit: 10485760, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] });
      if (created.error) throw new Error('Bucket creation failed');
    }
    const checked = await client.storage.getBucket(name);
    if (checked.error) throw new Error('Cannot verify bucket');
    assert.equal(checked.data.public, false);
    assert.equal(checked.data.file_size_limit, 10485760);
    assert.deepEqual([...checked.data.allowed_mime_types].sort(), ['image/jpeg','image/png','image/webp']);
    console.log(JSON.stringify({ bucket: name, private: true, maxBytes: 10485760, existingBucketsKept: before.data.filter(b => b.id !== name).map(b => b.id) }));
  } else if (process.argv[2] === 'local') {
    // Development-only configuration. Production/Preview settings are not modified.
    const file = path.join(root, '.env.development.local');
    const old = await fs.readFile(file, 'utf8').catch(error => { if(error.code === 'ENOENT') return null; throw error; });
    const current = dotenv.parse(old || '');
    const values = { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY, GENERATOR_ENABLED: 'true' };
    if (current.SUPABASE_SECRET_KEY) throw new Error('Existing preferred secret key requires manual review');
    for(const [key,value] of Object.entries(values)) if(current[key] !== undefined && current[key] !== value) throw new Error('Existing generator configuration requires review');
    const missing = Object.entries(values).filter(([key]) => current[key] === undefined);
    if (missing.length) {
      const lines = ['# Shared generator development DB; server-only credentials, never commit.', ...missing.map(([key,value]) => `${key}=${JSON.stringify(value)}`), ''];
      // Apply the edit without printing patch contents or secret values.
      const patch = old === null ? `*** Begin Patch\n*** Add File: ${file}\n${lines.map(line=>'+'+line).join('\n')}\n*** End Patch\n`
        : `*** Begin Patch\n*** Update File: ${file}\n@@\n${lines.map(line=>'+'+line).join('\n')}\n*** End Patch\n`;
      const result = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', cwd: root });
      if(result.status !== 0) throw new Error('Environment patch failed; details suppressed to protect secrets');
    }
    await fs.chmod(file, 0o600);
    const checked = dotenv.parse(await fs.readFile(file, 'utf8'));
    for(const [key,value] of Object.entries(values)) assert.equal(checked[key], value);
    console.log(JSON.stringify({ localDevelopmentConfigured: true, file, serverOnly: true, credentialType: 'existing legacy service_role', productionAndPreviewUnchanged: true }));
  } else throw new Error('Use storage or local');
} catch {
  console.error('Configuration failed; secret-bearing diagnostics suppressed. Inspect non-secret state before retrying.');
  process.exitCode = 1;
}
