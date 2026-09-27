import { ParkingError } from './parking-domain.mjs';

// Central replacement point for future authentication/authorization.
// Host/Origin checks are CSRF hardening, NOT user authentication.
export function authorizeParkingRequest(request) {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new ParkingError('LOCAL_ONLY', 'Diese API ist derzeit nur für den lokalen Betrieb freigegeben.', 403);
  }
  if (request.headers.get('origin') !== url.origin || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'))) {
    throw new ParkingError('ORIGIN_DENIED', 'Die Anfrage muss aus der lokalen Anwendung stammen.', 403);
  }
}

async function readJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new ParkingError('INVALID_CONTENT_TYPE', 'application/json wird erwartet.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ParkingError('INVALID_JSON', 'JSON-Eingabe fehlt.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new ParkingError('INPUT_TOO_LARGE', 'Die Eingabe ist zu groß.', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ParkingError('INVALID_JSON', 'Ungültige JSON-Eingabe.'); }
}

export function parkingPost(action, { body = true } = {}) {
  return async request => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
      authorizeParkingRequest(request);
      const result = await action(body ? await readJson(request) : undefined);
      return Response.json(result, { status: result.ok ? 200 : 409, headers });
    } catch (error) {
      // Never log/return raw Playwright errors, page text, URLs or credentials.
      const known = error instanceof ParkingError;
      return Response.json({ ok: false, code: known ? error.code : 'PARKING_FAILED', message: known ? error.message : 'Parkplatzaktion fehlgeschlagen. Bei einem Buchungsversuch zuerst den Status direkt bei ERGO prüfen.' }, { status: known ? error.status : 500, headers });
    }
  };
}
