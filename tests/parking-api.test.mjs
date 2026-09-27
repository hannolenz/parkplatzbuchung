import test from 'node:test';
import assert from 'node:assert/strict';
import { parkingPost } from '../lib/parking-api.mjs';
import { validateInput } from '../lib/parking-domain.mjs';
function request(body, headers = {}, url = 'http://localhost:3001/api/parking/reserve') {
  return new Request(url, { method: 'POST', headers: { origin: 'http://localhost:3001', 'content-type': 'application/json', ...headers }, body });
}
test('central guard rejects external host or cross-origin before action', async () => {
  const post = parkingPost(() => assert.fail('must not run'));
  for (const req of [request('{}', { origin: 'https://other.invalid' }), request('{}', {}, 'https://public.invalid/api/parking/reserve'), request('{}', { origin: '' })]) {
    assert.equal((await post(req)).status, 403);
  }
});
test('malformed/oversized JSON and wrong content type rejected', async () => {
  const post = parkingPost(() => assert.fail('must not run'));
  assert.equal((await post(request('{'))).status, 400);
  assert.equal((await post(request('"' + 'x'.repeat(17000) + '"'))).status, 413);
  assert.equal((await post(request('{}', { 'content-type': 'text/plain' }))).status, 415);
});
test('unknown errors never expose exception details', async () => {
  const post = parkingPost(() => { throw new Error('SECRET token password'); });
  const response = await post(request('{}'));
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('SECRET'));
});
test('validation errors get 400 and unverified result gets 409 without cache', async () => {
  const invalid = parkingPost(value => validateInput(value, true));
  assert.equal((await invalid(request('{}'))).status, 400);
  const post = parkingPost(() => ({ ok: false, outcome: 'unknown' }));
  const response = await post(request('{}'));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
