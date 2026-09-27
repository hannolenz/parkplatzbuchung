import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../lib/db/migrate.mjs';
import { createBookingRepository } from '../lib/planning/repository.mjs';
import { createWorkerRepository, CLAIM_SQL } from '../worker/repository.mjs';
import { runDryRunOnce } from '../worker/dry-run-service.mjs';
let pg, db, bookings, worker;
function adapter(client) {
  return { query: async (sql, params) => {
    if (!params && sql.includes('CREATE TABLE')) { const results = await client.exec(sql); return results.at(-1); }
    return client.query(sql, params);
  } };
}
before(async () => {
  pg = new PGlite();
  db = { ...adapter(pg), transaction: operation => pg.transaction(tx => operation(adapter(tx))) };
  await migrate(db);
  bookings = createBookingRepository(db); worker = createWorkerRepository(db);
});
after(async () => { await pg?.close(); });
beforeEach(async () => { await pg.exec('DELETE FROM booking_attempts; DELETE FROM planned_bookings;'); });
function plan(extra = {}) { return { parkingDate: '2026-09-27', slot: 'afternoon', stationPriorities: ['1181', '1183'], allowFallback: true, scheduledExecutionAt: '2000-01-01T00:00:00Z', releaseLeadDays: 1, timeZone: 'Europe/Berlin', ...extra }; }
test('migration applies once and required SQL/schema constraints exist', async () => {
  assert.deepEqual(await migrate(db), []);
  assert.match(CLAIM_SQL, /FOR UPDATE OF b SKIP LOCKED/);
  assert.match(CLAIM_SQL, /NOT EXISTS/);
  await assert.rejects(bookings.create(plan({ slot: 'night' })));
  await assert.rejects(bookings.create(plan({ stationPriorities: ['bad'] })));
});
test('CRUD roundtrip, optimistic edits and cancellation', async () => {
  const booking = await bookings.create(plan({ scheduledExecutionAt: '2099-01-01T00:00:00Z' }));
  assert.equal(booking.parkingDate, '2026-09-27');
  const edited = await bookings.update(booking.id, plan({ scheduledExecutionAt: '2099-01-01T00:00:00Z', version: 1, stationPriorities: ['1185'] }));
  assert.equal(edited.version, 2);
  await assert.rejects(bookings.update(booking.id, plan({ version: 1 })), { code: 'EDIT_CONFLICT' });
  assert.equal((await bookings.cancel(booking.id, 2)).status, 'cancelled');
  assert.equal((await bookings.list()).length, 1);
  assert.equal(await worker.claimDue('test-worker'), null);
});
test('duplicate active date/slot plans rejected; cancellation permits a new plan', async () => {
  const booking = await bookings.create(plan());
  await assert.rejects(bookings.create(plan()), { code: '23505' });
  await bookings.cancel(booking.id, 1);
  assert.ok(await bookings.create(plan()));
});
test('future plans are not claimed; expired unstarted plans cannot be edited', async () => {
  await bookings.create(plan({ scheduledExecutionAt: '2099-01-01T00:00:00Z' }));
  assert.equal(await worker.claimDue('worker-a'), null);
  const expired = await bookings.create(plan({ slot: 'morning' }));
  await assert.rejects(bookings.update(expired.id, plan({ version: 1 })), { code: 'EDIT_CONFLICT' });
});
test('competing claims yield exactly one owner and one attempt', async () => {
  await bookings.create(plan());
  const claims = await Promise.all([worker.claimDue('worker-a'), worker.claimDue('worker-b')]);
  assert.equal(claims.filter(Boolean).length, 1);
  const row = (await bookings.list())[0];
  assert.equal(row.status, 'preparing'); assert.equal(row.attemptCount, 1);
  assert.equal((await pg.query('SELECT * FROM booking_attempts')).rows.length, 1);
  await assert.rejects(bookings.cancel(row.id, row.version), { code: 'CANCEL_CONFLICT' });
});
test('claim transaction rolls back attempt and count if state update fails', async () => {
  await bookings.create(plan());
  const broken = createWorkerRepository({ ...db, transaction: operation => db.transaction(client => operation({ query: (sql, values) => {
    if (sql.startsWith('UPDATE planned_bookings SET status=')) throw new Error('injected');
    return client.query(sql, values);
  } })) });
  await assert.rejects(broken.claimDue('worker-a'));
  assert.equal((await pg.query('SELECT * FROM booking_attempts')).rows.length, 0);
  assert.equal((await bookings.list())[0].attemptCount, 0);
  assert.ok(await worker.claimDue('worker-a'));
});
test('wrong owner rejected; completion idempotent; no reprocessing or booked status', async () => {
  await bookings.create(plan());
  const claim = await worker.claimDue('worker-a');
  await assert.rejects(worker.start({ ...claim, workerId: 'worker-b' }), { code: 'CLAIM_CONFLICT' });
  await assert.rejects(worker.finishDryRun(claim), { code: 'CLAIM_CONFLICT' });
  await worker.start(claim);
  assert.equal(await worker.claimDue('worker-b'), null);
  await worker.finishDryRun(claim);
  assert.equal((await worker.finishDryRun(claim)).alreadyFinished, true);
  assert.equal(await worker.claimDue('worker-a'), null);
  const row = (await bookings.list())[0];
  assert.equal(row.status, 'planned'); assert.ok(row.dryRunCompletedAt); assert.equal(row.selectedStation, null);
  assert.equal((await pg.query('SELECT status FROM booking_attempts')).rows[0].status, 'simulated');
});
test('database rejects a simulated attempt being booked or duplicated', async () => {
  await bookings.create(plan()); const claim = await worker.claimDue('worker-a');
  await assert.rejects(pg.query("UPDATE booking_attempts SET status='booked' WHERE id=$1", [claim.attemptId]), { code: '23514' });
  await assert.rejects(pg.query(`INSERT INTO booking_attempts(id, booking_id, plan_version, mode, status, worker_id, input_snapshot)
    SELECT '00000000-0000-4000-8000-000000000001', booking_id, plan_version, mode, status, worker_id, input_snapshot FROM booking_attempts`), { code: '23505' });
});
test('dry-run service logs intended input and completes without choosing or booking a station', async () => {
  await bookings.create(plan());
  const logs = [];
  const result = await runDryRunOnce(worker, { workerId: 'worker-a', log: entry => logs.push(entry) });
  assert.equal(result.outcome, 'simulated'); assert.equal(result.booked, false);
  assert.equal(logs[0].selectedStation, null); assert.deepEqual(logs[0].stationPriorities, ['1181', '1183']);
  assert.equal((await runDryRunOnce(worker)).claimed, false);
});
test('worker failure remains failed, no automatic retry', async () => {
  await bookings.create(plan());
  await assert.rejects(runDryRunOnce(worker, { log: () => { throw new Error('fake failure'); } }));
  const row = (await bookings.list())[0];
  assert.equal(row.status, 'failed'); assert.equal(row.lastError, 'DRY_RUN_FAILED');
  assert.equal(await worker.claimDue('worker-b'), null);
});
