import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { workerConfig } from '../worker/config.mjs';
import { recoveryDecision } from '../worker/policy.mjs';
import { nextWakeDelay, abortableWait } from '../worker/scheduling.mjs';
import { runWorker, installShutdownHandlers } from '../worker/runtime.mjs';
import { scheduledExecutionAt } from '../lib/planning/domain.mjs';
const config = workerConfig({ WORKER_MODE: 'dry-run', WORKER_ID: 'test-worker' });
function fixtures() {
  const controller = new AbortController(); const events = [];
  const heartbeat = { register: async () => events.push('registered'), touch: async (_id, _instance, data) => events.push(data.state) };
  const repository = { recoverOrphans: async () => 0, nextSchedule: async () => 0 };
  return { controller, events, heartbeat, repository };
}
test('worker mode is explicit; live/missing/invalid identity fail closed', () => {
  for (const mode of [undefined, '', 'live', 'DRY-RUN']) assert.throws(() => workerConfig({ WORKER_MODE: mode, WORKER_ID: 'one' }), { code: 'DRY_RUN_MODE_REQUIRED' });
  assert.throws(() => workerConfig({ WORKER_MODE: 'dry-run' }), { code: 'WORKER_ID_REQUIRED' });
  assert.equal(config.mode, 'dry-run');
});
test('real worker entry refuses live/missing before opening any connection', () => {
  for (const mode of ['', 'live']) {
    const result = spawnSync(process.execPath, ['worker/run.mjs', '--once'], { env: { PATH: process.env.PATH, WORKER_MODE: mode, WORKER_ID: 'synthetic', DATABASE_URL: 'not-a-valid-url' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /ausschließlich Dry Run/); assert.ok(!result.stderr.includes('not-a-valid-url'));
  }
});
test('scheduling sleeps sparsely far away and wakes precisely near a known deadline', () => {
  assert.equal(nextWakeDelay(null), 30000);
  assert.equal(nextWakeDelay(3600000), 30000);
  assert.equal(nextWakeDelay(6000), 1000);
  assert.equal(nextWakeDelay(5000), 250);
  assert.equal(nextWakeDelay(100), 100);
  assert.equal(nextWakeDelay(100, 80), 25);
  assert.equal(nextWakeDelay(0), 25);
  assert.equal(nextWakeDelay(-60000), 25);
});
test('Berlin DST deadlines keep calendar-day semantics for daemon scheduling', () => {
  assert.equal(scheduledExecutionAt('2026-10-26', 1), '2026-10-24T22:01:00.000Z');
  assert.equal(scheduledExecutionAt('2026-10-27', 1), '2026-10-25T23:01:00.000Z');
  assert.equal(scheduledExecutionAt('2027-03-29', 1), '2027-03-27T23:01:00.000Z');
  assert.equal(scheduledExecutionAt('2027-03-30', 1), '2027-03-28T22:01:00.000Z');
});
test('future recovery policy distinguishes pre-click, uncertain click and authoritative evidence', () => {
  assert.deepEqual(recoveryDecision({ mode: 'live', phase: 'before_critical' }), { status: 'failed', retryEligible: true });
  for (const phase of ['critical','legacy_unknown']) assert.deepEqual(recoveryDecision({ mode: 'live', phase }), { status: 'unknown', retryEligible: false });
  assert.equal(recoveryDecision({ mode: 'live', phase: 'critical', evidence: 'confirmed_success' }).status, 'booked');
  assert.equal(recoveryDecision({ mode: 'dry_run', phase: 'critical', evidence: 'confirmed_success' }).status, 'simulated');
  assert.equal(recoveryDecision({ mode: 'live', phase: 'critical', evidence: 'confirmed_no_reservation' }).retryEligible, true);
});
test('SIGTERM/SIGINT abort waits and installed listeners are removed', async () => {
  for (const name of ['SIGTERM','SIGINT']) {
    const target = new EventEmitter(); const controller = new AbortController();
    const remove = installShutdownHandlers(controller, target);
    const sleeping = abortableWait(60000, controller.signal);
    target.emit(name); await sleeping; assert.ok(controller.signal.aborted);
    remove(); assert.equal(target.listenerCount(name), 0);
  }
});
test('daemon drains one in-flight job and does not claim again after shutdown', async () => {
  const f = fixtures(); let runs = 0;
  await runWorker({ ...f, config, signal: f.controller.signal, log: () => {}, runJob: async () => {
    runs++; f.controller.abort(); return { claimed: true, bookingId: '00000000-0000-4000-8000-000000000001' };
  } });
  assert.equal(runs, 1); assert.equal(f.events.at(-1), 'stopped');
});
test('daemon backs off and continues after errors without logging sensitive details', async () => {
  const f = fixtures(); let runs = 0; const logs = [], waits = [];
  await runWorker({ ...f, config, signal: f.controller.signal, log: entry => logs.push(entry),
    wait: async ms => waits.push(ms), runJob: async () => {
      runs++; if (runs < 3) throw new Error('SYNTHETIC_PASSWORD');
      f.controller.abort(); return { claimed: false };
    } });
  assert.deepEqual(waits, [1000,2000]); assert.equal(runs, 3);
  assert.ok(!JSON.stringify(logs).includes('SYNTHETIC_PASSWORD')); assert.equal(f.events.at(-1), 'stopped');
});
test('heartbeat continues during a waiting simulation and shuts down cleanly', async () => {
  const f = fixtures();
  await runWorker({ ...f, config: { ...config, heartbeatMs: 5 }, signal: f.controller.signal, log: () => {}, runJob: async () => {
    await abortableWait(30); f.controller.abort(); return { claimed: false };
  } });
  assert.ok(f.events.includes('working')); assert.equal(f.events.at(-1), 'stopped');
});
test('already aborted daemon never registers or claims', async () => {
  const f = fixtures(); f.controller.abort();
  await runWorker({ ...f, config, signal: f.controller.signal });
  assert.deepEqual(f.events, []);
});

test('worker entry import graph has no browser adapter, ERGO credentials or HTTP executor', async () => {
  const { readFile } = await import('node:fs/promises');
  const visited = new Set();
  async function visit(url) {
    if(visited.has(url.href)) return; visited.add(url.href);
    const text = await readFile(url,'utf8');
    assert.ok(!/\b(?:PARKING_USERNAME|PARKING_PASSWORD)\b/.test(text));
    assert.ok(!/\b(?:fetch|eval)\s*\(/.test(text));
    for(const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      const name=match[1]; assert.ok(!/playwright|puppeteer|parking\.js/.test(name));
      if(name.startsWith('.') && !name.endsWith('.json')) await visit(new URL(name,url));
    }
  }
  await visit(new URL('../worker/run.mjs',import.meta.url));
  await visit(new URL('../worker/dry-run.mjs',import.meta.url));
});

test('systemd restart budget bridges stale-owner grace period before rate limiting', async () => {
  const { readFile } = await import('node:fs/promises');
  const unit=await readFile(new URL('../deploy/parkplatzbuchung-worker.service',import.meta.url),'utf8');
  const burst=Number(unit.match(/^StartLimitBurst=(\d+)$/m)[1]);
  const interval=Number(unit.match(/^RestartSec=(\d+)$/m)[1]);
  assert.ok((burst-1)*interval>60);
  assert.match(unit,/^Restart=on-failure$/m);
  assert.match(unit,/^KillSignal=SIGTERM$/m);
});
