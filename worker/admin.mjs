import { validateId, validateVersion } from '../lib/planning/domain.mjs';
import { WorkerError } from './config.mjs';
export function dryRunAdmin(db) {
  return {
    async makeDue(id, version, delaySeconds) {
      validateId(id); validateVersion(version);
      if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 300) throw new WorkerError('INVALID_DELAY');
      const result = await db.query(`UPDATE planned_bookings SET dry_run_only=true,
        dry_run_original_execution_at=coalesce(dry_run_original_execution_at,scheduled_execution_at),
        scheduled_execution_at=clock_timestamp()+$3*interval '1 second',version=version+1,updated_at=clock_timestamp(),
        result_message='Expliziter kurzfristiger Dry-run-Test. Dauerhaft für Live-Ausführung gesperrt.'
        WHERE id=$1 AND version=$2 AND status='planned' AND attempt_count=0
        AND NOT EXISTS (SELECT 1 FROM booking_attempts WHERE booking_id=$1) RETURNING id,version`, [id, version, delaySeconds]);
      if (!result.rows.length) throw new WorkerError('TEST_PLAN_CONFLICT');
      return result.rows[0];
    },
    async retryBeforeCritical(id, version) {
      validateId(id); validateVersion(version);
      return db.transaction(async client => {
        // Same lock order as the reaper: attempt, then plan. No active attempt is eligible.
        const attempt = (await client.query(`SELECT * FROM booking_attempts WHERE booking_id=$1 AND plan_version=$2 AND mode='dry_run'
          AND status='failed' AND retry_eligible AND execution_phase='before_critical' FOR UPDATE`, [id, version])).rows[0];
        if (!attempt) throw new WorkerError('RETRY_FORBIDDEN');
        const result = await client.query(`UPDATE planned_bookings SET status='planned',version=version+1,dry_run_only=true,
          dry_run_original_execution_at=coalesce(dry_run_original_execution_at,scheduled_execution_at),
          scheduled_execution_at=clock_timestamp(),started_at=NULL,finished_at=NULL,last_error=NULL,dry_run_completed_at=NULL,
          updated_at=clock_timestamp(),result_message='Kontrollierter Dry-run-Retry vor kritischem Punkt freigegeben.'
          WHERE id=$1 AND version=$2 AND status='failed' AND attempt_count<3 RETURNING id,version`, [id, version]);
        if (!result.rows.length) throw new WorkerError('RETRY_FORBIDDEN');
        return result.rows[0];
      });
    }
  };
}
