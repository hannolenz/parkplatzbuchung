import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../lib/db/migrate.mjs';
import { createBookingRepository } from '../lib/planning/repository.mjs';
import { createWorkerRepository } from '../worker/repository.mjs';
import { heartbeatRepository } from '../worker/heartbeat.mjs';
import { dryRunAdmin } from '../worker/admin.mjs';
import { workerHealth } from '../lib/db/worker-health.mjs';
import { runDryRunOnce } from '../worker/dry-run-service.mjs';
let pg, db, bookings, worker, beats, admin;
function adapter(client, fixedClock = null) { return { query: async (sql, params) => {
  if (fixedClock) sql = sql.replaceAll('clock_timestamp()', "TIMESTAMPTZ '2026-09-29T22:01:00Z'");
  return !params && sql.includes('CREATE TABLE') ? (await client.exec(sql)).at(-1) : client.query(sql, params);
} }; }
before(async () => {
  pg = new PGlite(); db = { ...adapter(pg), transaction: op => pg.transaction(tx => op(adapter(tx))) };
  await migrate(db); bookings = createBookingRepository(db); worker = createWorkerRepository(db); beats = heartbeatRepository(db); admin = dryRunAdmin(db);
});
after(async () => pg?.close());
beforeEach(async () => { await pg.exec('DELETE FROM booking_attempts; DELETE FROM planned_bookings; DELETE FROM worker_instances;'); });
const plan = () => ({ parkingDate:'2026-10-01',slot:'morning',stationPriorities:['1181','1183','1185'],allowFallback:true,scheduledExecutionAt:'2000-01-01T00:00:00Z',releaseLeadDays:1,timeZone:'Europe/Berlin' });
const register = async (workerId = 'worker-a') => { const instanceId = randomUUID(); await beats.register({ workerId, version:'phase-3a' }, instanceId); return instanceId; };
const row = async () => (await bookings.list())[0];
const attempt = async () => (await pg.query('SELECT * FROM booking_attempts ORDER BY created_at DESC')).rows[0];
const expire = async () => pg.query("UPDATE booking_attempts SET lease_until=clock_timestamp()-interval '1 second'");
test('not due one millisecond before; claim exactly at database deadline', async () => {
  const frozen = { ...adapter(pg, true), transaction: op => pg.transaction(tx => op(adapter(tx, true))) };
  const w = createWorkerRepository(frozen);
  const p = await bookings.create({ ...plan(),scheduledExecutionAt:'2026-09-29T22:01:00.001Z' });
  assert.equal(await w.claimDue('worker-a'),null); assert.equal(await w.nextSchedule(),1);
  await pg.query("UPDATE planned_bookings SET scheduled_execution_at='2026-09-29T22:01:00Z' WHERE id=$1",[p.id]);
  assert.ok(await w.claimDue('worker-a'));
});
test('two registered workers compete for exactly one claim and unique attempt', async () => {
  await bookings.create(plan()); const a=await register(),b=await register('worker-b');
  const claims=await Promise.all([worker.claimDue('worker-a',a),worker.claimDue('worker-b',b)]);
  assert.equal(claims.filter(Boolean).length,1); assert.equal((await row()).attemptCount,1);
  assert.ok((await attempt()).lease_until); assert.equal((await attempt()).execution_phase,'before_critical');
});
test('successful dry run updates attempt and heartbeat; restart cannot replay it', async () => {
  const p=await bookings.create(plan()); const id=await register();
  const result=await runDryRunOnce(worker,{workerId:'worker-a',instanceId:id,log:()=>{}});
  assert.equal(result.booked,false); assert.equal((await row()).status,'planned');
  assert.equal((await attempt()).status,'simulated'); assert.equal((await attempt()).execution_phase,'completed');
  assert.equal((await workerHealth(db)).workers[0].lastSuccessfulJob,p.id);
  await beats.touch('worker-a',id,{state:'stopped'}); const fresh=await register();
  assert.equal(await worker.claimDue('worker-a',fresh),null);
});
test('crash before simulated critical point fails safely; bounded manual retry gets new attempt', async () => {
  const p=await bookings.create(plan());
  await assert.rejects(runDryRunOnce(worker,{log:()=>{throw new Error('test');}}));
  const old=await attempt(); assert.equal(old.status,'failed'); assert.ok(old.retry_eligible);
  assert.equal(await worker.claimDue('worker-a'),null);
  const changed=await admin.retryBeforeCritical(p.id,1); assert.equal(changed.version,2);
  assert.ok((await row()).dryRunOnly);
  await runDryRunOnce(worker,{log:()=>{}}); assert.notEqual((await attempt()).id,old.id);
  assert.equal((await row()).attemptCount,2); assert.notEqual((await row()).status,'booked');
});
test('failure during simulated critical point is unknown, never automatically or manually retried', async () => {
  const p=await bookings.create(plan());
  await assert.rejects(runDryRunOnce(worker,{log:()=>{},simulate:async()=>{throw new Error('synthetic');}}));
  assert.equal((await row()).status,'unknown'); assert.equal((await attempt()).status,'unknown');
  assert.equal((await attempt()).retry_eligible,false);
  assert.equal(await worker.claimDue('worker-a'),null);
  await assert.rejects(admin.retryBeforeCritical(p.id,1),{code:'RETRY_FORBIDDEN'});
});
test('expired pre-critical orphan becomes failed and fences delayed completion', async () => {
  await bookings.create(plan()); const claim=await worker.claimDue('worker-a'); await worker.start(claim); await expire();
  assert.equal(await worker.recoverOrphans(),1); assert.equal((await row()).status,'failed');
  assert.equal((await attempt()).last_error,'ORPHAN_BEFORE_CRITICAL');
  await assert.rejects(worker.finishDryRun(claim),{code:'CLAIM_CONFLICT'});
  assert.equal(await worker.recoverOrphans(),0);
});
test('expired post-critical orphan becomes unknown and does not retry', async () => {
  await bookings.create(plan()); const claim=await worker.claimDue('worker-a'); await worker.start(claim); await worker.markSimulatedCritical(claim); await expire();
  assert.equal(await worker.recoverOrphans(),1); assert.equal((await row()).status,'unknown');
  assert.equal(await worker.claimDue('worker-a'),null);
});
test('legacy active attempt with no known phase is never assumed retry-safe', async () => {
  await bookings.create(plan()); await worker.claimDue('worker-a');
  await pg.query("UPDATE booking_attempts SET execution_phase='legacy_unknown',lease_until=NULL,created_at=clock_timestamp()-interval '3 minutes'");
  assert.equal(await worker.recoverOrphans(),1); assert.equal((await row()).status,'unknown');
});
test('lease expiration cannot be resurrected by heartbeat or completed by old process', async () => {
  await bookings.create(plan()); const id=await register(); const claim=await worker.claimDue('worker-a',id);
  await worker.start(claim); await expire(); await beats.touch('worker-a',id);
  await assert.rejects(worker.finishDryRun(claim),{code:'CLAIM_CONFLICT'});
  assert.equal(await worker.recoverOrphans(),1);
});
test('same worker ID cannot run twice; a stale instance is fenced after replacement', async () => {
  const old=await register(); await assert.rejects(register(),{code:'WORKER_ID_BUSY'});
  await pg.query("UPDATE worker_instances SET heartbeat_at=clock_timestamp()-interval '61 seconds'");
  const fresh=await register(); assert.notEqual(old,fresh);
  await assert.rejects(beats.touch('worker-a',old),{code:'WORKER_INSTANCE_LOST'});
  await assert.rejects(worker.claimDue('worker-a',old),{code:'CLAIM_CONFLICT'});
});
test('heartbeat health reports active, degraded, stale and stopped; error values are constrained', async () => {
  const id=await register(); assert.equal((await workerHealth(db)).worker,'dry-run');
  await beats.touch('worker-a',id,{state:'degraded',lastError:'WORKER_CYCLE_FAILED'});
  assert.equal((await workerHealth(db)).worker,'degraded');
  await assert.rejects(beats.touch('worker-a',id,{lastError:'SYNTHETIC_SECRET'}));
  await pg.query("UPDATE worker_instances SET heartbeat_at=clock_timestamp()-interval '61 seconds'");
  assert.equal((await workerHealth(db)).worker,'inactive');
  await beats.touch('worker-a',id,{state:'stopped'}); assert.equal((await workerHealth(db)).workers[0].state,'disconnected');
});
test('short due override is irreversible dry-run-only, preserves original time and rejects live/booked', async () => {
  const p=await bookings.create({...plan(),scheduledExecutionAt:'2099-01-01T00:00:00Z'});
  assert.equal((await admin.makeDue(p.id,1,0)).version,2);
  const result=await row(); assert.equal(result.dryRunOnly,true); assert.equal(result.dryRunOriginalExecutionAt,'2099-01-01T00:00:00.000Z');
  await assert.rejects(admin.makeDue(p.id,1,0),{code:'TEST_PLAN_CONFLICT'});
  await assert.rejects(pg.query("UPDATE planned_bookings SET status='booked' WHERE id=$1",[p.id]),{code:'23514'});
  await assert.rejects(pg.query('UPDATE planned_bookings SET dry_run_only=false WHERE id=$1',[p.id]),{code:'23514'});
  await assert.rejects(pg.query(`INSERT INTO booking_attempts(id,booking_id,plan_version,mode,status,worker_id,input_snapshot)
    VALUES ($1,$2,2,'live','preparing','worker-a','{}')`,[randomUUID(),p.id]),{code:'23514'});
  await runDryRunOnce(worker,{log:()=>{}}); assert.equal((await attempt()).status,'simulated');
});
test('manual retries are capped at three total attempts, never unbounded', async () => {
  const p=await bookings.create(plan());
  for(let version=1;version<=3;version++) {
    await assert.rejects(runDryRunOnce(worker,{log:()=>{throw new Error('synthetic');}}));
    if(version<3) await admin.retryBeforeCritical(p.id,version);
  }
  await assert.rejects(admin.retryBeforeCritical(p.id,3),{code:'RETRY_FORBIDDEN'});
  assert.equal((await row()).attemptCount,3);
});
test('additive migration preserves pre-existing plan and auth session', async () => {
  const old=new PGlite();
  try {
    for(const name of ['001_planned_bookings.sql','002_web_auth.sql']) await old.exec(await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'));
    const repo=createBookingRepository(adapter(old)); const p=await repo.create(plan());
    await old.query("INSERT INTO app_sessions(token_hash,credential_version,expires_at) VALUES ($1,$2,clock_timestamp()+interval '1 hour')",['a'.repeat(64),'b'.repeat(64)]);
    await old.exec(await readFile(new URL('../db/migrations/003_worker_runtime.sql',import.meta.url),'utf8'));
    assert.equal((await repo.list())[0].id,p.id); assert.equal((await repo.list())[0].dryRunOnly,false);
    assert.equal((await old.query('SELECT count(*) FROM app_sessions')).rows[0].count,1);
  } finally {await old.close();}
});

test('complete daemon one-shot lifecycle uses real SQL and leaves a stopped heartbeat with success', async () => {
  const { runWorker } = await import('../worker/runtime.mjs');
  const { workerConfig } = await import('../worker/config.mjs');
  const p=await bookings.create(plan());
  await runWorker({ repository:worker, heartbeat:beats, config:workerConfig({WORKER_MODE:'dry-run',WORKER_ID:'full-cycle'}), once:true, log:()=>{} });
  assert.equal((await row()).status,'planned'); assert.equal((await attempt()).status,'simulated');
  const health=await workerHealth(db); assert.equal(health.workers[0].state,'disconnected');
  assert.equal(health.workers[0].lastSuccessfulJob,p.id);
});
