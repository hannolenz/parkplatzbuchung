const errors = new Set(['WORKER_CYCLE_FAILED','HEARTBEAT_FAILED','ORPHAN_RECOVERED']);
export async function workerHealth(database) {
  try {
    const { rows } = await database.query(`SELECT worker_id,mode,version,state,heartbeat_at,last_successful_job,last_error,
      heartbeat_at>clock_timestamp()-interval '60 seconds' AS fresh FROM worker_instances ORDER BY heartbeat_at DESC LIMIT 20`);
    const workers = rows.filter(row => typeof row.worker_id === 'string').map(row => ({
      workerId: row.worker_id, mode: row.mode === 'dry-run' ? 'dry-run' : row.mode === 'live' ? 'live' : 'unknown',
      version: /^(?:phase-3a|[a-f0-9]{7,40})$/.test(row.version || '') ? row.version : 'unknown',
      state: !row.fresh || row.state === 'stopped' ? 'disconnected' : row.state === 'degraded' || row.mode === 'live' ? 'degraded' : 'active',
      lastHeartbeat: new Date(row.heartbeat_at).toISOString(), lastSuccessfulJob: row.last_successful_job,
      lastError: row.last_error ? errors.has(row.last_error) ? row.last_error : 'WORKER_ERROR' : null
    }));
    const worker = workers.some(w => w.state === 'degraded') ? 'degraded' : workers.some(w => w.state === 'active') ? 'dry-run' : 'inactive';
    return { worker, workers };
  } catch { return { worker: 'unavailable', workers: [] }; }
}
