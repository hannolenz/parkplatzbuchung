import { getDatabase } from '../lib/db/connection.mjs';
import { migrate } from '../lib/db/migrate.mjs';
let db;
try {
  db = getDatabase();
  const files = await migrate(db);
  console.log(JSON.stringify({ migrationsApplied: files }));
} catch {
  console.error('Migration fehlgeschlagen. Datenbankkonfiguration, Erreichbarkeit und Migrationsstand lokal prüfen.');
  process.exitCode = 1;
} finally { await db?.close(); }
