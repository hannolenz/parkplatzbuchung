import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchedulingRule, scheduledExecutionAt, validatePlan, validateCancellation, canTransition, validateId } from '../lib/planning/domain.mjs';
import { createPlanningService, planningConfiguration } from '../lib/planning/service.mjs';
const form = { parkingDate: '2027-01-12', slot: 'afternoon', stationPriorities: ['1181', '1183'], allowFallback: true };
const rule = { leadDays: 1 };
const now = new Date('2026-09-27T10:00:00Z');
test('release rule has no default and exposes no environment secrets', () => {
  assert.throws(() => getSchedulingRule({}), { code: 'SCHEDULE_NOT_CONFIGURED' });
  for (const value of ['', '01', '-1', '366', '1.5']) assert.throws(() => getSchedulingRule({ BOOKING_RELEASE_LEAD_DAYS: value }));
  assert.equal(getSchedulingRule({ BOOKING_RELEASE_LEAD_DAYS: '0' }).leadDays, 0);
  assert.deepEqual(planningConfiguration({ DATABASE_URL: 'not-a-real-connection-secret' }), { databaseConfigured: true, schedulingConfigured: false, rule: null, executionMode: 'dry_run' });
});
test('execution uses Berlin 00:01, calendar days and both DST boundaries', () => {
  assert.equal(scheduledExecutionAt('2027-01-12', 1), '2027-01-10T23:01:00.000Z');
  assert.equal(scheduledExecutionAt('2026-07-12', 0), '2026-07-11T22:01:00.000Z');
  assert.equal(scheduledExecutionAt('2026-03-30', 1), '2026-03-28T23:01:00.000Z');
  assert.equal(scheduledExecutionAt('2026-03-31', 1), '2026-03-29T22:01:00.000Z');
  assert.equal(scheduledExecutionAt('2026-10-26', 1), '2026-10-24T22:01:00.000Z');
  assert.equal(scheduledExecutionAt('2026-10-27', 1), '2026-10-25T23:01:00.000Z');
  assert.equal(scheduledExecutionAt('2028-03-01', 1), '2028-02-28T23:01:00.000Z');
  assert.equal(scheduledExecutionAt('2027-01-01', 1), '2026-12-30T23:01:00.000Z');
});
test('invalid dates/lead days and past execution are rejected', () => {
  assert.throws(() => scheduledExecutionAt('2027-02-29', 1));
  assert.throws(() => scheduledExecutionAt('2027-01-01', undefined));
  assert.throws(() => validatePlan(form, rule, { now: new Date('2027-01-11') }), { code: 'EXECUTION_IN_PAST' });
});
test('CRUD validation rejects controlled status, bad choices, wrong types and versions', () => {
  const plan = validatePlan({ ...form, stationPriorities: ['1181', '1181', '1183'] }, rule, { now });
  assert.deepEqual(plan.stationPriorities, ['1181', '1183']);
  for (const patch of [{ status: 'booked' }, { scheduledExecutionAt: '2027-01-01' }, { slot: 'night' }, { allowFallback: 'true' }, { stationPriorities: [1181] }, { stationPriorities: [], allowFallback: false }]) assert.throws(() => validatePlan({ ...form, ...patch }, rule, { now }));
  assert.throws(() => validatePlan(form, rule, { now, editing: true }), { code: 'INVALID_VERSION' });
  assert.equal(validatePlan({ ...form, version: 3 }, rule, { now, editing: true }).version, 3);
  assert.equal(validateCancellation({ version: 1 }), 1);
  for (const body of [null, {}, { version: '1' }, { version: 1, status: 'booked' }]) assert.throws(() => validateCancellation(body));
  assert.throws(() => validateId('../unsafe'));
});
test('allowed state transitions and dry-run cannot book', () => {
  assert.ok(canTransition('planned', 'preparing'));
  assert.ok(canTransition('planned', 'cancelled'));
  assert.ok(canTransition('preparing', 'running'));
  assert.ok(canTransition('running', 'unknown'));
  assert.ok(canTransition('running', 'booked'));
  assert.ok(!canTransition('running', 'booked', { mode: 'dry_run' }));
  assert.ok(canTransition('running', 'planned', { mode: 'dry_run' }));
  for (const state of ['booked', 'failed', 'unknown', 'cancelled']) assert.ok(!canTransition(state, 'planned'));
  assert.ok(!canTransition('running', 'planned'));
  assert.ok(!canTransition('planned', 'booked'));
});
test('service validates create/update/cancel before calling repository', async () => {
  let calls = 0;
  const repo = { create: async plan => { calls++; return plan; }, update: async () => { calls++; }, cancel: async () => { calls++; } };
  const service = createPlanningService(repo, { env: { BOOKING_RELEASE_LEAD_DAYS: '1' }, now: () => now });
  const result = await service.create(form);
  assert.equal(result.scheduledExecutionAt, '2027-01-10T23:01:00.000Z');
  assert.throws(() => service.update('bad', {}));
  assert.throws(() => service.cancel('bad', {}));
  assert.equal(calls, 1);
});


test('confirmed release rule: previous calendar day at Berlin 00:01 for both slots', () => {
  const rule = getSchedulingRule({ BOOKING_RELEASE_LEAD_DAYS: '1' });
  for (const [parkingDate, expected] of [
    ['2026-09-29', '2026-09-27T22:01:00.000Z'],
    ['2026-10-02', '2026-09-30T22:01:00.000Z']
  ]) {
    assert.equal(scheduledExecutionAt(parkingDate, rule.leadDays), expected);
    for (const slot of ['morning', 'afternoon']) {
      assert.equal(validatePlan({ ...form, parkingDate, slot }, rule, { now }).scheduledExecutionAt, expected);
    }
  }
});
test('versioned environment example contains confirmed lead days and only placeholders', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^BOOKING_RELEASE_LEAD_DAYS=1$/m);
  assert.match(example, /^DATABASE_URL=postgresql:\/\/USER:PASSWORD@localhost:5432\/parkplatzbuchung$/m);
  assert.match(example, /^PARKING_USERNAME=$/m);
  assert.match(example, /^PARKING_PASSWORD=$/m);
});
