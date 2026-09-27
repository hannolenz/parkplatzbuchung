import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withParkingLock, withBrowserResources, beginAttempt } from '../lib/parking-runtime.mjs';
import { projectText, saveDiagnostic } from '../lib/parking-diagnostics.mjs';

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'parking-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('concurrent actions are rejected; lock released after success and exception', async t => {
  const dir = await directory(t);
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const first = withParkingLock(dir, async () => { entered(); await held; });
  await started;
  await assert.rejects(withParkingLock(dir, () => assert.fail('must not enter')), { code: 'PARKING_BUSY' });
  release(); await first;
  await assert.rejects(withParkingLock(dir, () => { throw new Error('test'); }));
  assert.equal(await withParkingLock(dir, () => 42), 42);
});
test('existing lock is never removed automatically', async t => {
  const dir = await directory(t);
  await fs.mkdir(path.join(dir, 'operation.lock'));
  await assert.rejects(withParkingLock(dir, () => {}), { code: 'PARKING_BUSY' });
  assert.ok((await fs.stat(path.join(dir, 'operation.lock'))).isDirectory());
});
test('attempt marker prevents duplicate date/slot including changed station', async t => {
  const dir = await directory(t);
  const input = { date: '2026-09-28', slot: 'morning', expectedStation: '1181' };
  await beginAttempt(dir, input);
  await assert.rejects(beginAttempt(dir, { ...input, expectedStation: '1183' }), { code: 'ATTEMPT_EXISTS' });
  await beginAttempt(dir, { ...input, slot: 'afternoon' });
});
for (const stage of ['context', 'page', 'login', 'timeout', 'operation', 'success']) {
  test(`browser resources close at ${stage}`, async () => {
    const calls = [];
    const browser = { close: async () => calls.push('browser') };
    const context = { close: async () => calls.push('context') };
    const action = withBrowserResources(async () => browser, async (_, register) => {
      if (stage !== 'context') register(context);
      if (stage !== 'success') throw new Error(stage);
      return 7;
    });
    if (stage === 'success') assert.equal(await action, 7);
    else await assert.rejects(action, { message: stage });
    assert.deepEqual(calls, stage === 'context' ? ['browser'] : ['context', 'browser']);
  });
}
test('launch failure preserved', async () => {
  await assert.rejects(withBrowserResources(async () => { throw new Error('launch'); }, () => {}), { message: 'launch' });
});
test('browser close attempted even when context close fails; lock retained', async t => {
  const dir = await directory(t);
  let browserClosed = false;
  await assert.rejects(withParkingLock(dir, () => withBrowserResources(
    async () => ({ close: async () => { browserClosed = true; } }),
    async (_, register) => { register({ close: async () => { throw new Error('close'); } }); }
  )), { code: 'CLEANUP_FAILED' });
  assert.equal(browserClosed, true);
  await assert.rejects(withParkingLock(dir, () => {}), { code: 'PARKING_BUSY' });
});
test('diagnostic vocabulary removes credentials, identities, URLs and numbers', async t => {
  const text = projectText('Reservierung erfolgreich user@example.invalid Passwort123 https://example.invalid/?token=abc CookieXYZ 1181 frei', ['erfolgreich', 'Passwort123']);
  assert.ok(text.includes('reservierung'));
  for (const secret of ['erfolgreich', 'user', 'Passwort123', 'example', 'abc', 'CookieXYZ', '1181']) assert.ok(!text.includes(secret));
  const dir = await directory(t);
  const id = await saveDiagnostic(dir, { text });
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal((await fs.stat(path.join(dir, 'diagnostics', `${id}.json`))).mode & 0o777, 0o600);
});
