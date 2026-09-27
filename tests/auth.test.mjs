import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../lib/db/migrate.mjs';
import { authRepository } from '../lib/auth/repository.mjs';
import { createAuthService } from '../lib/auth/service.mjs';
import { authConfig, hashPassword, assertOrigin, AuthError, digestToken, sessionCookie, readSessionCookie } from '../lib/auth/core.mjs';
import { gateRequest } from '../lib/auth/gate.mjs';
import { authHandlers } from '../lib/auth/http.mjs';
import { planningRoute } from '../lib/planning/http.mjs';
let pg, db, repository, service, env;
const password = 'synthetic-test-password-only';
function adapter(client) { return { query: async (sql, params) => !params && sql.includes('CREATE TABLE') ? (await client.exec(sql)).at(-1) : client.query(sql, params) }; }
before(async () => {
  pg = new PGlite(); db = { ...adapter(pg), transaction: operation => pg.transaction(tx => operation(adapter(tx))) };
  await migrate(db); repository = authRepository(db);
  env = { NODE_ENV: 'development', APP_AUTH_ORIGIN: 'http://localhost:3001', APP_AUTH_USERNAME: 'synthetic-user', APP_AUTH_PASSWORD_HASH: await hashPassword(password) };
  service = createAuthService(repository, { env });
});
after(async () => { await pg?.close(); });
beforeEach(async () => { await pg.exec('DELETE FROM app_sessions; DELETE FROM app_login_limits;'); });
function req(path = '/api/auth/login', { method = 'POST', cookie = '', origin = 'http://localhost:3001', body } = {}) {
  return new Request('http://localhost:3001' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const credentials = () => ({ username: env.APP_AUTH_USERNAME, password });
const login = async (cookie = '') => (await service.login(req(undefined, { cookie }), credentials())).split(';')[0];
test('login creates only a hashed DB session; valid and manipulated sessions', async () => {
  const cookie = await login(); const token = cookie.split('=')[1];
  assert.deepEqual(await service.requireSession(new Headers({ cookie })), { authenticated: true });
  const rows = (await pg.query('SELECT * FROM app_sessions')).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].token_hash, digestToken(token));
  assert.ok(!JSON.stringify(rows).includes(token));
  await assert.rejects(service.requireSession(new Headers()), { status: 401 });
  await assert.rejects(service.requireSession(new Headers({ cookie: 'parking_session=' + 'a'.repeat(43) })), { status: 401 });
});
test('failed username and password return the same error and create no session', async () => {
  for (const body of [{ ...credentials(), username: 'wrong' }, { ...credentials(), password: 'wrong' }]) {
    await assert.rejects(service.login(req(), body), { code: 'LOGIN_FAILED', status: 401 });
  }
  assert.equal((await pg.query('SELECT * FROM app_sessions')).rows.length, 0);
});
test('login rotates prior session; logout revokes captured cookie and clears browser cookie', async () => {
  const old = await login(); const fresh = await login(old);
  assert.notEqual(old, fresh);
  await assert.rejects(service.requireSession(new Headers({ cookie: old })), { status: 401 });
  const clear = await service.logout(req('/api/auth/logout', { cookie: fresh }));
  assert.match(clear, /Max-Age=0/);
  await assert.rejects(service.requireSession(new Headers({ cookie: fresh })), { status: 401 });
});
test('expiry and credential rotation invalidate sessions', async () => {
  const cookie = await login();
  const changed = createAuthService(repository, { env: { ...env, APP_AUTH_USERNAME: 'new-user' } });
  await assert.rejects(changed.requireSession(new Headers({ cookie })), { status: 401 });
  await pg.query("UPDATE app_sessions SET expires_at=clock_timestamp()-interval '1 second'");
  await assert.rejects(service.requireSession(new Headers({ cookie })), { status: 401 });
});
test('shared rate limit allows only ten concurrent admissions and resets after its window', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => repository.consumeLoginAttempt()));
  assert.equal(results.filter(Boolean).length, 10);
  await assert.rejects(service.login(req(), credentials()), { status: 429 });
  await pg.query("UPDATE app_login_limits SET window_started_at=clock_timestamp()-interval '16 minutes'");
  assert.equal(await repository.consumeLoginAttempt(), true);
});
test('cookies are HttpOnly, Strict, host-only and Secure in production; duplicate cookies rejected', () => {
  const token = 'a'.repeat(43);
  const cookie = sessionCookie(token, true);
  assert.match(cookie, /^__Host-parking_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/); assert.ok(!cookie.includes('Domain='));
  assert.equal(readSessionCookie(new Headers({ cookie: `parking_session=${token}; parking_session=${token}` }), false), null);
  assert.throws(() => authConfig({ ...env, NODE_ENV: 'production' }), { status: 503 });
  assert.equal(authConfig({ ...env, NODE_ENV: 'production', APP_AUTH_ORIGIN: 'https://parking.example' }).production, true);
  assert.throws(() => authConfig({}), { status: 503 });
});
test('login and logout reject missing/foreign Origin and same-site cross-origin requests', async () => {
  for (const origin of ['', 'https://attacker.invalid']) {
    await assert.rejects(service.login(req(undefined, { origin }), credentials()), { status: 403 });
    await assert.rejects(service.logout(req('/api/auth/logout', { origin })), { status: 403 });
  }
  const request = req(); request.headers.set('sec-fetch-site', 'same-site');
  assert.throws(() => assertOrigin(request, env), { status: 403 });
  assert.doesNotThrow(() => assertOrigin(new Request('https://parking.example/api/bookings', { method: 'POST', headers: { origin: 'https://parking.example' } }), { APP_AUTH_ORIGIN: 'https://parking.example', VERCEL: '1' }));
});
test('every private page and API is gated; login and static assets are public', async () => {
  const deny = async () => { throw new AuthError('UNAUTHENTICATED', 'Bitte anmelden.', 401); };
  for (const path of ['/', '/future-page', '/_next/image']) assert.equal((await gateRequest(req(path, { method: 'GET' }), deny)).headers.get('location'), 'http://localhost:3001/login');
  for (const path of ['/api/bookings', '/api/bookings/id', '/api/system/status', '/api/parking/reserve']) assert.equal((await gateRequest(req(path), deny)).status, 401);
  for (const path of ['/login', '/api/auth/login', '/_next/static/file.js']) assert.equal(await gateRequest(req(path), deny), null);
  assert.equal(await gateRequest(req('/'), async () => {}), null);
});
test('booking API rechecks session independently of proxy and does not run unauthorized actions', async () => {
  let calls = 0;
  const route = planningRoute(async () => { calls++; return { bookings: [] }; }, { authenticate: r => service.requireSession(r.headers) });
  assert.equal((await route(req('/api/bookings'))).status, 401); assert.equal(calls, 0);
  assert.equal((await route(req('/api/bookings', { cookie: await login() }))).status, 200); assert.equal(calls, 1);
});
test('HTTP login/logout set safe cookies; malformed JSON and internal errors never leak', async () => {
  const handlers = authHandlers(() => service, env);
  const success = await handlers.login(req(undefined, { body: credentials() }));
  assert.equal(success.status, 200); assert.equal(success.headers.get('cache-control'), 'no-store');
  const cookie = success.headers.get('set-cookie').split(';')[0];
  assert.equal((await handlers.logout(req('/api/auth/logout', { cookie }))).status, 200);
  const broken = authHandlers(() => { throw new Error('SYNTHETIC_SECRET'); }, env);
  const response = await broken.login(req(undefined, { body: credentials() }));
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('SYNTHETIC_SECRET'));
  assert.equal((await handlers.login(new Request('http://localhost:3001/api/auth/login', { method: 'POST', headers: { origin: env.APP_AUTH_ORIGIN, 'content-type': 'application/json' }, body: '{' }))).status, 400);
});
