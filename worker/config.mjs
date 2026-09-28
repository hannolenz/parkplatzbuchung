export class WorkerError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function workerConfig(env = process.env) {
  if (env.WORKER_MODE !== 'dry-run') throw new WorkerError('DRY_RUN_MODE_REQUIRED');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(env.WORKER_ID || '')) throw new WorkerError('WORKER_ID_REQUIRED');
  if (env.WORKER_VERSION && !/^[a-f0-9]{7,40}$/.test(env.WORKER_VERSION)) throw new WorkerError('INVALID_WORKER_VERSION');
  return { workerId: env.WORKER_ID, mode: 'dry-run', version: env.WORKER_VERSION || 'phase-3a', heartbeatMs: 15000, recoveryMs: 30000 };
}
