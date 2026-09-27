import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../db/migrations/', import.meta.url);
const entries = [];
for (const name of (await readdir(root)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
  entries.push({ name, checksum: createHash('sha256').update(await readFile(new URL(name, root))).digest('hex') });
}
await writeFile(new URL('../lib/db/migration-manifest.json', import.meta.url), JSON.stringify(entries, null, 2) + '\n');
