import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePlanningRequest, planningRoute, readPlanningJson } from '../lib/planning/http.mjs';
function request(method = 'POST', body = '{}', headers = {}) {
  return new Request('http://localhost:3001/api/bookings', { method, headers: { 'content-type': 'application/json', ...(method !== 'GET' ? { origin: 'http://localhost:3001' } : {}), ...headers }, ...(method !== 'GET' ? { body } : {}) });
}
test('origin guard fails closed for unconfigured online hosts; writes require Origin', () => {
  assert.doesNotThrow(() => authorizePlanningRequest(request('GET'), {}));
  assert.doesNotThrow(() => authorizePlanningRequest(request(), {}));
  assert.throws(() => authorizePlanningRequest(request('POST', '{}', { origin: '' }), {}), { status: 403 });
  assert.throws(() => authorizePlanningRequest(request('GET', '', { 'sec-fetch-site': 'cross-site' }), {}), { status: 403 });
  assert.throws(() => authorizePlanningRequest(request(), { VERCEL: '1' }), { status: 403 });
  assert.throws(() => authorizePlanningRequest(new Request('https://public.invalid/api/bookings'), {}), { status: 403 });
});
test('invalid JSON, wrong content type and oversized input rejected', async () => {
  await assert.rejects(readPlanningJson(request('POST', '{')), { code: 'INVALID_JSON' });
  await assert.rejects(readPlanningJson(request('POST', '{}', { 'content-type': 'text/plain' })), { status: 415 });
  await assert.rejects(readPlanningJson(request('POST', 'x'.repeat(17000))), { status: 413 });
});
test('database errors never expose connection strings and responses are not cached', async () => {
  const route = planningRoute(() => { throw new Error('postgres://user:fake-password@private.invalid/db'); }, { authenticate: async () => {} });
  const response = await route(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(!(await response.text()).includes('fake-password'));
});
test('unique conflicts receive safe 409 response', async () => {
  const route = planningRoute(() => { const error = new Error('private SQL'); error.code = '23505'; throw error; }, { authenticate: async () => {} });
  assert.equal((await route(request())).status, 409);
});


test('manual parking APIs are disabled on Vercel before invoking any action', async () => {
  const { parkingPost } = await import('../lib/parking-api.mjs');
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  let called = false;
  try {
    const response = await parkingPost(() => { called = true; return { ok: true }; })(request());
    assert.equal(response.status, 403);
    assert.equal(called, false);
  } finally {
    if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
  }
});
