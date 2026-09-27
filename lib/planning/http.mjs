import { PlanningError } from './domain.mjs';

import { assertOrigin, AuthError } from '../auth/core.mjs';
import { requireSessionRequest } from '../auth/server.mjs';
export function authorizePlanningRequest(request, env = process.env) { assertOrigin(request, env); }
export async function readPlanningJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new PlanningError('INVALID_CONTENT_TYPE', 'application/json wird erwartet.', 415);
  if (!request.body) throw new PlanningError('INVALID_JSON', 'JSON-Eingabe fehlt.');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new PlanningError('INPUT_TOO_LARGE', 'Die Eingabe ist zu groß.', 413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PlanningError('INVALID_JSON', 'Ungültige JSON-Eingabe.'); }
}
export function planningRoute(action, { authenticate = requireSessionRequest } = {}) {
  return async (request, context) => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
      authorizePlanningRequest(request);
      await authenticate(request);
      return Response.json({ ok: true, ...await action(request, context) }, { headers });
    } catch (error) {
      const known = error instanceof PlanningError || error instanceof AuthError;
      const duplicate = error?.code === '23505';
      return Response.json({ ok: false, code: known ? error.code : duplicate ? 'DUPLICATE_PLAN' : 'PLANNING_UNAVAILABLE',
        message: known ? error.message : duplicate ? 'Für dieses Datum und diesen Slot existiert bereits ein Plan.' : 'Planungsdaten nicht verfügbar. Datenbank und Migrationen lokal prüfen.' },
      { status: known ? error.status : duplicate ? 409 : 503, headers });
    }
  };
}
