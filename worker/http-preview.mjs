import { workerConfig } from './config.mjs';
import { createErgoReader } from '../lib/ergo-http/client.mjs';
import { ERGO_ORIGIN } from '../lib/ergo-http/policy.mjs';
import { validateReadInput } from '../lib/ergo-http/domain.mjs';
import { createHttpPreviewService } from './http-preview-service.mjs';
// Explicit one-shot read only. No database import, claiming, scheduling or writing.
let adapter;
try {
  const config = workerConfig(); // live rejected before constructing a client.
  if (process.env.PARKING_URL && ![ERGO_ORIGIN, ERGO_ORIGIN + '/'].includes(process.env.PARKING_URL)) throw new Error();
  const [date, slot, priorities, fallback, ...extra] = process.argv.slice(2);
  if (extra.length || !['true', 'false'].includes(fallback)) throw new Error();
  const input = validateReadInput({ date, slot, priorities: priorities ? priorities.split(',') : [], fallback: fallback === 'true' });
  adapter = createErgoReader({ username: process.env.PARKING_USERNAME, password: process.env.PARKING_PASSWORD });
  const preview = createHttpPreviewService(adapter, config);
  await preview.prepareSession();
  const result = await preview.readPlan({ parkingDate: input.date, slot: input.slot, stationPriorities: input.priorities, allowFallback: input.fallback });
  console.log(JSON.stringify({ event: 'HTTP_READ_ONLY_PREVIEW', date: result.date, slot: result.slot, stations: result.stations.length, free: result.stations.filter(s => s.free).length, chargingExcluded: result.chargingExcluded, selectedStation: result.suggested?.number || null, booked: false }));
} catch {
  console.error('HTTP_READ_ONLY_FAILED: Eingabe, Session, Datum oder Antwort prüfen. Keine Buchung ausgeführt.');
  process.exitCode = 1;
} finally { try { await adapter?.close(); } catch { process.exitCode = 1; } }
