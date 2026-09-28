import { workerConfig } from './config.mjs';
import { createWorkerRepository } from './repository.mjs';
import { heartbeatRepository } from './heartbeat.mjs';
import { runWorker, installShutdownHandlers } from './runtime.mjs';
import { getDatabase } from '../lib/db/connection.mjs';
export async function main(args = process.argv.slice(2)) {
  let db; const controller = new AbortController();
  const removeHandlers = installShutdownHandlers(controller);
  try {
    const config = workerConfig(); // Missing mode or live stops before any DB access.
    if (args.some(arg => arg !== '--once')) throw new Error('INVALID_ARGUMENT');
    db = getDatabase();
    await runWorker({ repository: createWorkerRepository(db), heartbeat: heartbeatRepository(db), config, signal: controller.signal, once: args.includes('--once') });
  } catch {
    console.error('WORKER_STOPPED: Konfiguration, Migrationen oder Worker-Status prüfen. Phase 3A erlaubt ausschließlich Dry Run.');
    process.exitCode = 1;
  } finally { removeHandlers(); try { await db?.close(); } catch { process.exitCode = 1; } }
}
