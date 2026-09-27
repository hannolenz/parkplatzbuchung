import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runReservationAttempt } from '../lib/parking-attempt.mjs';
const input = { date: '2026-09-28', slot: 'morning', expectedStation: '1181' };
for (const failure of ['none', 'click', 'observe', 'capture', 'save']) {
  test(`post-click ${failure}: unknown result, at most one click, retry blocked`, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'parking-attempt-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    let clicks = 0;
    let captures = 0;
    const dependencies = {
      directory, input,
      capture: async () => { if (++captures > 1 && failure === 'capture') throw new Error('private'); return { messages: ['reservierung erfolgreich'] }; },
      save: async data => { if (data.phase === 'after' && failure === 'save') throw new Error('private'); return 'offline-diagnostic'; },
      click: async () => {
        assert.ok(await fs.stat(path.join(directory, 'attempts', '2026-09-28-morning.json')));
        clicks++;
        if (failure === 'click') throw new Error('private');
      },
      observe: async () => { if (failure === 'observe') throw new Error('private'); }
    };
    const result = await runReservationAttempt(dependencies);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'unknown');
    assert.equal(clicks, 1);
    assert.ok(!JSON.stringify(result).includes('private'));
    // Restore diagnostic hooks; the persisted marker alone must block another click.
    await assert.rejects(runReservationAttempt({ ...dependencies, capture: async () => ({}), save: async () => 'id' }), { code: 'ATTEMPT_EXISTS' });
    assert.equal(clicks, 1);
  });
}
test('failed pre-click diagnosis prevents click entirely', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'parking-attempt-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(runReservationAttempt({ directory, input, capture: async () => ({}), save: async () => { throw new Error('disk'); }, click: () => assert.fail('no click'), observe: () => {} }));
});
