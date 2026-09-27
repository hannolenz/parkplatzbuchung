import { getDatabase } from '../lib/db/connection.mjs';
import { createWorkerRepository } from './repository.mjs';
import { runDryRunOnce } from './dry-run-service.mjs';
let db;
try {
  if (process.argv.slice(2).some(arg => arg !== '--once')) throw new Error('UNSUPPORTED_ARGUMENT');
  db = getDatabase();
  const result = await runDryRunOnce(createWorkerRepository(db), { workerId: process.env.WORKER_ID || 'local-dry-run' });
  console.log(JSON.stringify(result));
} catch {
  console.error('Dry-Run fehlgeschlagen. Lokale DB-Konfiguration und Auftragsstatus prüfen. Keine ERGO-Ausführung.');
  process.exitCode = 1;
} finally { await db?.close(); }
