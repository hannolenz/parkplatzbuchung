import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { abortableWait, nextWakeDelay } from './scheduling.mjs';
import { runDryRunOnce } from './dry-run-service.mjs';
import { WorkerError } from './config.mjs';
export function installShutdownHandlers(controller, target = process) {
  const stop = () => controller.abort();
  target.on('SIGTERM', stop); target.on('SIGINT', stop);
  return () => { target.off('SIGTERM', stop); target.off('SIGINT', stop); };
}
export async function runWorker({ repository, heartbeat, config, signal, once = false,
  log = entry => console.log(JSON.stringify(entry)), wait = abortableWait, now = () => performance.now(), runJob = runDryRunOnce }) {
  if (config.mode !== 'dry-run') throw new WorkerError('DRY_RUN_MODE_REQUIRED');
  if (signal?.aborted) return;
  const instanceId = randomUUID();
  await heartbeat.register(config, instanceId);
  let lastRecovery = -Infinity, errors = 0, stopping = false;
  let state = 'idle', lastError = null;
  // Only fixed event codes and validated IDs are logged; never raw exceptions.
  const emit = entry => { try { log(entry); } catch { /* Logging must not change execution state. */ } };
  const touch = args => heartbeat.touch(config.workerId, instanceId, args);
  // Independent heartbeat continues during a bounded in-flight dry-run operation.
  const beatController = new AbortController();
  const beatLoop = (async () => {
    while (!beatController.signal.aborted) {
      await abortableWait(config.heartbeatMs, beatController.signal);
      if (beatController.signal.aborted) break;
      try { await touch({ state, lastError }); }
      catch { lastError = 'HEARTBEAT_FAILED'; emit({ event: 'HEARTBEAT_FAILED' }); }
    }
  })();
  try {
    while (!signal?.aborted && !stopping) {
      try {
        // Refresh ownership before every cycle; cannot continue after replacement.
        await touch({ state: 'idle', lastError });
        if (now() - lastRecovery >= config.recoveryMs) {
          const recovered = await repository.recoverOrphans(); lastRecovery = now();
          if (recovered) { lastError = 'ORPHAN_RECOVERED'; emit({ event: 'ORPHAN_RECOVERED', count: recovered }); }
        }
        if (signal?.aborted) break;
        state = 'working';
        const result = await runJob(repository, { workerId: config.workerId, instanceId, signal, log: emit });
        state = 'idle'; errors = 0;
        if (result.claimed) { lastError = null; await touch({ state, successfulJob: result.bookingId }); emit({ event: 'DRY_RUN_COMPLETED', bookingId: result.bookingId }); }
        if (once || signal?.aborted) break;
        if (result.claimed) continue;
        const started = now();
        const untilDue = await repository.nextSchedule();
        await wait(nextWakeDelay(untilDue, now() - started), signal);
      } catch (error) {
        state = 'degraded'; lastError = 'WORKER_CYCLE_FAILED'; errors++;
        emit({ event: 'WORKER_CYCLE_FAILED' });
        if (error?.code === 'WORKER_INSTANCE_LOST' || error?.code === 'CLAIM_CONFLICT') stopping = true;
        try { await touch({ state, lastError }); } catch { /* Recover on next bounded cycle, never dump DB errors. */ }
        if (once) throw new WorkerError('WORKER_CYCLE_FAILED');
        if (!stopping && !signal?.aborted) await wait(Math.min(30000, 1000 * 2 ** Math.min(errors - 1, 5)), signal);
      }
    }
  } finally {
    state = 'stopping'; beatController.abort(); await beatLoop;
    try { await touch({ state: 'stopped', lastError }); } catch { /* Stale heartbeat will reveal an unclean shutdown. */ }
  }
}
