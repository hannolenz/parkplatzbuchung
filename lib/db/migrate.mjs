import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function migrate(database) {
  const directory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
  const files = (await fs.readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort();
  return database.transaction(async client => {
    // Serializes concurrent migrators. No migration ever runs automatically on a request.
    await client.query('SELECT pg_advisory_xact_lock(20260927, 2)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map(r => [r.name, r.checksum]));
    const changed = [];
    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [file, checksum]);
      changed.push(file);
    }
    return changed;
  });
}
