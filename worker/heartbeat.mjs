import { validateId } from '../lib/planning/domain.mjs';
import { WorkerError } from './config.mjs';
export function heartbeatRepository(db) {
  return {
    async register(config, instanceId) {
      validateId(instanceId);
      const result = await db.query(`INSERT INTO worker_instances AS w(worker_id,instance_id,mode,version,state)
        VALUES ($1,$2,'dry-run',$3,'idle') ON CONFLICT(worker_id) DO UPDATE SET
        instance_id=excluded.instance_id,mode=excluded.mode,version=excluded.version,state='idle',
        heartbeat_at=clock_timestamp(),started_at=clock_timestamp(),last_error=NULL
        WHERE w.state='stopped' OR w.heartbeat_at<=clock_timestamp()-interval '60 seconds'
        RETURNING worker_id`, [config.workerId, instanceId, config.version]);
      if (!result.rows.length) throw new WorkerError('WORKER_ID_BUSY');
    },
    async touch(workerId, instanceId, { state = 'idle', lastError = null, successfulJob = null } = {}) {
      if (!['idle','working','degraded','stopping','stopped'].includes(state)) throw new WorkerError('INVALID_WORKER_STATE');
      if (lastError !== null && !['WORKER_CYCLE_FAILED','HEARTBEAT_FAILED','ORPHAN_RECOVERED'].includes(lastError)) throw new WorkerError('INVALID_WORKER_ERROR');
      if (successfulJob) validateId(successfulJob);
      return db.transaction(async client => {
        const row = await client.query(`UPDATE worker_instances SET state=$3,heartbeat_at=clock_timestamp(),last_error=$4,
          last_successful_job=coalesce($5::uuid,last_successful_job) WHERE worker_id=$1 AND instance_id=$2 RETURNING worker_id`,
        [workerId, instanceId, state, lastError, successfulJob]);
        if (!row.rows.length) throw new WorkerError('WORKER_INSTANCE_LOST');
        if (!['stopping','stopped'].includes(state)) {
          await client.query(`UPDATE booking_attempts SET heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '120 seconds'
            WHERE worker_id=$1 AND worker_instance_id=$2 AND mode='dry_run' AND status IN ('preparing','running') AND lease_until>clock_timestamp()`, [workerId, instanceId]);
        }
      });
    }
  };
}
