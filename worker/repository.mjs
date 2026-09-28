import { randomUUID } from 'node:crypto';
import { PlanningError, assertTransition, validateId } from '../lib/planning/domain.mjs';
import { bookingDTO } from '../lib/planning/repository.mjs';
import { recoveryDecision } from './policy.mjs';
const ELIGIBLE = `b.status='planned' AND NOT EXISTS (SELECT 1 FROM booking_attempts a WHERE a.booking_id=b.id AND a.plan_version=b.version AND a.mode='dry_run')`;
export const CLAIM_SQL = `SELECT b.*, b.parking_date::text AS parking_date FROM planned_bookings b
  WHERE ${ELIGIBLE} AND b.scheduled_execution_at <= clock_timestamp()
  ORDER BY b.scheduled_execution_at, b.id FOR UPDATE OF b SKIP LOCKED LIMIT 1`;
const SIMULATED = 'Simulation abgeschlossen. Keine ERGO-Aktion und keine Buchung ausgeführt.';
function workerId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new PlanningError('INVALID_WORKER', 'Ungültige Worker-Kennung.');
  return value;
}
function conflict() { return new PlanningError('CLAIM_CONFLICT', 'Claim abgelaufen, fremd oder abgeschlossen.', 409); }
async function fence(client, id, instanceId) {
  if (!instanceId) return; // Legacy in-process tests/one-shot repository interface.
  validateId(instanceId);
  const result = await client.query(`SELECT worker_id FROM worker_instances WHERE worker_id=$1 AND instance_id=$2
    AND state NOT IN ('stopped','stopping') AND heartbeat_at>clock_timestamp()-interval '60 seconds' FOR SHARE`, [id, instanceId]);
  if (!result.rows.length) throw conflict();
}
async function ownedAttempt(client, claim) {
  validateId(claim.attemptId); workerId(claim.workerId);
  await fence(client, claim.workerId, claim.instanceId);
  const row = (await client.query(`SELECT *, lease_until>clock_timestamp() AS lease_valid FROM booking_attempts
    WHERE id=$1 AND worker_id=$2 AND mode='dry_run' AND worker_instance_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE`,
  [claim.attemptId, claim.workerId, claim.instanceId || null])).rows[0];
  if (!row) throw conflict();
  return row;
}
export function createWorkerRepository(database) {
  return {
    async nextSchedule() {
      const row = (await database.query(`SELECT extract(epoch FROM (min(b.scheduled_execution_at)-clock_timestamp()))*1000 AS delay_ms
        FROM planned_bookings b WHERE ${ELIGIBLE}`)).rows[0];
      return row.delay_ms === null ? null : Number(row.delay_ms);
    },
    async claimDue(id, instanceId = null) {
      workerId(id);
      return database.transaction(async client => {
        await fence(client, id, instanceId);
        const booking = bookingDTO((await client.query(CLAIM_SQL)).rows[0]);
        if (!booking) return null;
        assertTransition(booking.status, 'preparing', { mode: 'dry_run' });
        const attemptId = randomUUID();
        const input = { parkingDate: booking.parkingDate, slot: booking.slot, stationPriorities: booking.stationPriorities,
          allowFallback: booking.allowFallback, scheduledExecutionAt: booking.scheduledExecutionAt, dryRunOnly: booking.dryRunOnly };
        await client.query(`INSERT INTO booking_attempts(id, booking_id, plan_version, mode, status, worker_id, input_snapshot,
          execution_phase, lease_until, heartbeat_at, worker_instance_id)
          VALUES ($1,$2,$3,'dry_run','preparing',$4,$5::jsonb,'before_critical',clock_timestamp()+interval '120 seconds',clock_timestamp(),$6)`,
        [attemptId, booking.id, booking.version, id, JSON.stringify(input), instanceId]);
        await client.query(`UPDATE planned_bookings SET status='preparing', attempt_count=attempt_count+1,
          started_at=clock_timestamp(), finished_at=NULL, updated_at=clock_timestamp(), last_error=NULL WHERE id=$1`, [booking.id]);
        return { attemptId, bookingId: booking.id, version: booking.version, workerId: id, instanceId, mode: 'dry_run', input };
      });
    },
    async start(claim) {
      return database.transaction(async client => {
        const attempt = await ownedAttempt(client, claim);
        if (attempt.status !== 'preparing' || !attempt.lease_valid) throw conflict();
        const changed = await client.query(`UPDATE planned_bookings SET status='running', updated_at=clock_timestamp()
          WHERE id=$1 AND version=$2 AND status='preparing' RETURNING id`, [attempt.booking_id, attempt.plan_version]);
        if (!changed.rows.length) throw conflict();
        await client.query(`UPDATE booking_attempts SET status='running', started_at=clock_timestamp() WHERE id=$1`, [claim.attemptId]);
      });
    },
    async markSimulatedCritical(claim) {
      return database.transaction(async client => {
        const attempt = await ownedAttempt(client, claim);
        if (attempt.status !== 'running' || !attempt.lease_valid || attempt.execution_phase !== 'before_critical') throw conflict();
        await client.query(`UPDATE booking_attempts SET execution_phase='critical' WHERE id=$1`, [claim.attemptId]);
      });
    },
    async finishDryRun(claim) {
      return database.transaction(async client => {
        const attempt = await ownedAttempt(client, claim);
        if (attempt.status === 'simulated') return { alreadyFinished: true };
        if (attempt.status !== 'running' || !attempt.lease_valid) throw conflict();
        const changed = await client.query(`UPDATE planned_bookings SET status='planned', dry_run_completed_at=clock_timestamp(),
          finished_at=clock_timestamp(), updated_at=clock_timestamp(), result_message=$3, last_error=NULL
          WHERE id=$1 AND version=$2 AND status='running' RETURNING id`, [attempt.booking_id, attempt.plan_version, SIMULATED]);
        if (!changed.rows.length) throw conflict();
        await client.query(`UPDATE booking_attempts SET status='simulated', execution_phase='completed', finished_at=clock_timestamp(),
          lease_until=NULL, result_message=$2 WHERE id=$1`, [claim.attemptId, SIMULATED]);
        if (claim.instanceId) await client.query(`UPDATE worker_instances SET last_successful_job=$3,heartbeat_at=clock_timestamp(),state='idle',last_error=NULL
          WHERE worker_id=$1 AND instance_id=$2`, [claim.workerId, claim.instanceId, attempt.booking_id]);
        return { alreadyFinished: false };
      });
    },
    async failDryRun(claim) {
      return database.transaction(async client => {
        const attempt = await ownedAttempt(client, claim);
        if (!['preparing','running'].includes(attempt.status)) return false;
        if (!attempt.lease_valid) throw conflict(); // Expired claims belong to the reaper, not a delayed process.
        await concludeFailure(client, attempt, false);
        return true;
      });
    },
    async recoverOrphans() {
      return database.transaction(async client => {
        const rows = (await client.query(`SELECT * FROM booking_attempts WHERE mode='dry_run' AND status IN ('preparing','running')
          AND (lease_until<=clock_timestamp() OR (lease_until IS NULL AND created_at<clock_timestamp()-interval '120 seconds'))
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20`)).rows;
        for (const row of rows) await concludeFailure(client, row, true);
        return rows.length;
      });
    }
  };
}
async function concludeFailure(client, attempt, orphan) {
  const decision = recoveryDecision({ mode: attempt.mode, phase: attempt.execution_phase });
  const code = decision.status === 'unknown' ? 'SIMULATED_OUTCOME_UNKNOWN' : orphan ? 'ORPHAN_BEFORE_CRITICAL' : 'DRY_RUN_FAILED';
  const message = decision.status === 'unknown' ? 'Simulation am kritischen Punkt unterbrochen. Menschliche Prüfung erforderlich; kein Retry. Keine ERGO-Aktion ausgeführt.' : 'Simulation vor kritischem Punkt abgebrochen. Kontrollierter Dry-run-Retry möglich. Keine ERGO-Aktion ausgeführt.';
  const changed = await client.query(`UPDATE planned_bookings SET status=$3, finished_at=clock_timestamp(), updated_at=clock_timestamp(), last_error=$4, result_message=$5
    WHERE id=$1 AND version=$2 AND status IN ('preparing','running') RETURNING id`, [attempt.booking_id, attempt.plan_version, decision.status, code, message]);
  if (!changed.rows.length) throw conflict();
  await client.query(`UPDATE booking_attempts SET status=$2, finished_at=clock_timestamp(), lease_until=NULL, retry_eligible=$3, last_error=$4, result_message=$5 WHERE id=$1`,
  [attempt.id, decision.status, decision.retryEligible, code, message]);
}
