import { randomUUID } from 'node:crypto';
import { PlanningError, assertTransition, validateId } from '../lib/planning/domain.mjs';
import { bookingDTO } from '../lib/planning/repository.mjs';
export const CLAIM_SQL = `SELECT b.*, b.parking_date::text AS parking_date FROM planned_bookings b
  WHERE b.status='planned' AND b.scheduled_execution_at <= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM booking_attempts a WHERE a.booking_id=b.id AND a.plan_version=b.version AND a.mode='dry_run')
  ORDER BY b.scheduled_execution_at, b.id FOR UPDATE OF b SKIP LOCKED LIMIT 1`;
const SIMULATED = 'Simulation abgeschlossen. Keine ERGO-Aktion und keine Buchung ausgeführt.';
function workerId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new PlanningError('INVALID_WORKER', 'Ungültige Worker-Kennung.');
  return value;
}
function conflict() { return new PlanningError('CLAIM_CONFLICT', 'Der Ausführungsversuch gehört nicht diesem Worker oder ist bereits abgeschlossen.', 409); }
export function createWorkerRepository(database) {
  return {
    async claimDue(id) {
      workerId(id);
      return database.transaction(async client => {
        const booking = bookingDTO((await client.query(CLAIM_SQL)).rows[0]);
        if (!booking) return null;
        assertTransition(booking.status, 'preparing', { mode: 'dry_run' });
        const attemptId = randomUUID();
        const input = { parkingDate: booking.parkingDate, slot: booking.slot, stationPriorities: booking.stationPriorities,
          allowFallback: booking.allowFallback, scheduledExecutionAt: booking.scheduledExecutionAt };
        await client.query(`INSERT INTO booking_attempts(id, booking_id, plan_version, mode, status, worker_id, input_snapshot)
          VALUES ($1,$2,$3,'dry_run','preparing',$4,$5::jsonb)`, [attemptId, booking.id, booking.version, id, JSON.stringify(input)]);
        await client.query(`UPDATE planned_bookings SET status='preparing', attempt_count=attempt_count+1,
          started_at=clock_timestamp(), finished_at=NULL, updated_at=clock_timestamp(), last_error=NULL WHERE id=$1`, [booking.id]);
        return { attemptId, bookingId: booking.id, version: booking.version, workerId: id, mode: 'dry_run', input };
      });
    },
    async start(claim) {
      validateId(claim.attemptId); workerId(claim.workerId);
      return database.transaction(async client => {
        const attempt = (await client.query(`SELECT * FROM booking_attempts WHERE id=$1 AND worker_id=$2 AND mode='dry_run' FOR UPDATE`, [claim.attemptId, claim.workerId])).rows[0];
        if (!attempt || attempt.status !== 'preparing') throw conflict();
        assertTransition('preparing', 'running', { mode: 'dry_run' });
        const changed = await client.query(`UPDATE planned_bookings SET status='running', updated_at=clock_timestamp()
          WHERE id=$1 AND version=$2 AND status='preparing' RETURNING id`, [attempt.booking_id, attempt.plan_version]);
        if (!changed.rows.length) throw conflict();
        await client.query(`UPDATE booking_attempts SET status='running', started_at=clock_timestamp() WHERE id=$1`, [claim.attemptId]);
      });
    },
    async finishDryRun(claim) {
      validateId(claim.attemptId); workerId(claim.workerId);
      return database.transaction(async client => {
        const attempt = (await client.query(`SELECT * FROM booking_attempts WHERE id=$1 AND worker_id=$2 AND mode='dry_run' FOR UPDATE`, [claim.attemptId, claim.workerId])).rows[0];
        if (!attempt) throw conflict();
        if (attempt.status === 'simulated') return { alreadyFinished: true }; // Idempotent completion.
        if (attempt.status !== 'running') throw conflict();
        assertTransition('running', 'planned', { mode: 'dry_run' });
        const changed = await client.query(`UPDATE planned_bookings SET status='planned', dry_run_completed_at=clock_timestamp(),
          finished_at=clock_timestamp(), updated_at=clock_timestamp(), result_message=$3, last_error=NULL
          WHERE id=$1 AND version=$2 AND status='running' RETURNING id`, [attempt.booking_id, attempt.plan_version, SIMULATED]);
        if (!changed.rows.length) throw conflict();
        await client.query(`UPDATE booking_attempts SET status='simulated', finished_at=clock_timestamp(), result_message=$2 WHERE id=$1`, [claim.attemptId, SIMULATED]);
        return { alreadyFinished: false };
      });
    },
    async failDryRun(claim) {
      validateId(claim.attemptId); workerId(claim.workerId);
      return database.transaction(async client => {
        const attempt = (await client.query(`SELECT * FROM booking_attempts WHERE id=$1 AND worker_id=$2 AND mode='dry_run' FOR UPDATE`, [claim.attemptId, claim.workerId])).rows[0];
        if (!attempt || !['preparing', 'running'].includes(attempt.status)) return false;
        assertTransition(attempt.status, 'failed', { mode: 'dry_run' });
        const changed = await client.query(`UPDATE planned_bookings SET status='failed', finished_at=clock_timestamp(), updated_at=clock_timestamp(),
          last_error='DRY_RUN_FAILED', result_message='Simulation fehlgeschlagen; keine ERGO-Aktion ausgeführt.'
          WHERE id=$1 AND version=$2 AND status IN ('preparing','running') RETURNING id`, [attempt.booking_id, attempt.plan_version]);
        if (!changed.rows.length) throw conflict();
        await client.query(`UPDATE booking_attempts SET status='failed', finished_at=clock_timestamp(), last_error='DRY_RUN_FAILED' WHERE id=$1`, [claim.attemptId]);
        return true;
      });
    }
  };
}
