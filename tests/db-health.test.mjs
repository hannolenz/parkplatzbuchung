import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import expected from '../lib/db/migration-manifest.json' with { type: 'json' };
import { systemHealth } from '../lib/db/health.mjs';
import { poolOptions } from '../lib/db/config.mjs';
test('health distinguishes reachable/current, outdated, missing and unreachable without details', async () => {
  const db = rows => ({ query: async () => ({ rows }) });
  assert.equal((await systemHealth(db(expected))).migrations, 'current');
  assert.equal((await systemHealth(db([]))).migrations, 'pending');
  assert.equal((await systemHealth(db(expected.map(e => ({ ...e, checksum: 'wrong' }))))).migrations, 'pending');
  const down = await systemHealth({ query: async () => { throw new Error('private connection string'); } });
  assert.equal(down.database, 'unreachable'); assert.equal(down.worker, 'inactive'); assert.ok(!JSON.stringify(down).includes('private'));
  const missing = await systemHealth({ query: async sql => { if (sql !== 'SELECT 1') throw { code: '42P01' }; return { rows: [] }; } });
  assert.equal(missing.migrations, 'pending');
});
test('versioned migration manifest matches exact SQL files for serverless health checks', async () => {
  const root = new URL('../db/migrations/', import.meta.url);
  const files = (await readdir(root)).filter(n => n.endsWith('.sql')).sort();
  assert.deepEqual(files, expected.map(e => e.name));
  for (const entry of expected) assert.equal(createHash('sha256').update(await readFile(new URL(entry.name, root))).digest('hex'), entry.checksum);
});
test('DB pool verifies TLS, bounds connections, refuses SSL URL overrides and plaintext production', () => {
  const url = 'postgresql://synthetic:placeholder@database.invalid/parking';
  const opts = poolOptions({ DATABASE_URL: url, NODE_ENV: 'production' });
  assert.equal(opts.ssl.rejectUnauthorized, true); assert.equal(opts.max, 3); assert.equal(opts.allowExitOnIdle, true);
  assert.equal(poolOptions({ DATABASE_URL: 'postgresql://localhost/parking', DATABASE_SSL: 'disable' }).ssl, false);
  for (const env of [{ DATABASE_SSL: 'disable' }, { DATABASE_POOL_MAX: '100' }, { DATABASE_URL: url + '?sslmode=require' }, { DATABASE_URL: url + '?sslcert=path' }]) assert.throws(() => poolOptions({ DATABASE_URL: url, ...env }), { status: 503 });
  assert.throws(() => poolOptions({ DATABASE_URL: 'postgresql://localhost/parking', DATABASE_SSL: 'disable', VERCEL: '1' }), { status: 503 });
});
