// Database-derived interval, corrected conservatively for the round-trip time.
// Do not compare deadlines to the VPS wall clock or subtract UTC days here.
export function nextWakeDelay(untilDueMs, queryElapsedMs = 0) {
  if (untilDueMs === null) return 30000;
  if (!Number.isFinite(untilDueMs)) throw new Error('INVALID_SCHEDULE');
  const remaining = untilDueMs - Math.max(0, queryElapsedMs);
  if (remaining > 5000) return Math.min(30000, remaining - 5000);
  return Math.max(25, Math.min(250, remaining));
}
export function abortableWait(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
