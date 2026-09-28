import { workerConfig } from './config.mjs';
import { getDatabase } from '../lib/db/connection.mjs';
import { dryRunAdmin } from './admin.mjs';
let db;
try {
  workerConfig();
  const [action, id, version, confirmation, delay = '60', ...extra] = process.argv.slice(2);
  if (extra.length || !['make-due','retry-before-critical'].includes(action) || confirmation !== '--confirm-dry-run' || !/^[1-9]\d*$/.test(version || '') || !/^\d{1,3}$/.test(delay)) throw new Error();
  db = getDatabase(); const admin = dryRunAdmin(db);
  const result = action === 'make-due' ? await admin.makeDue(id, Number(version), Number(delay)) : await admin.retryBeforeCritical(id, Number(version));
  console.log(JSON.stringify({ event: 'DRY_RUN_PLAN_UPDATED', id: result.id, version: result.version }));
} catch { console.error('DRY_RUN_ADMIN_FAILED: Modus, explizite Bestätigung, Planversion und zulässigen Zustand prüfen.'); process.exitCode = 1; }
finally { try { await db?.close(); } catch { process.exitCode = 1; } }
