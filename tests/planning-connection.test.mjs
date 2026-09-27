import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/db/connection.mjs';

test('transaction commits and releases its dedicated connection', async () => {
  const events = [];
  const db = createDatabase({ connect: async () => ({ query: async sql => events.push(sql), release: discard => events.push(discard) }) });
  assert.equal(await db.transaction(async client => { await client.query('WORK'); return 42; }), 42);
  assert.deepEqual(events, ['BEGIN', 'WORK', 'COMMIT', false]);
});
test('transaction rolls back on failure; broken rollback discards connection', async () => {
  for (const brokenRollback of [false, true]) {
    const events = [];
    const db = createDatabase({ connect: async () => ({
      query: async sql => { events.push(sql); if (sql === 'ROLLBACK' && brokenRollback) throw new Error('closed'); },
      release: discard => events.push(discard)
    }) });
    await assert.rejects(db.transaction(async () => { throw new Error('operation failed'); }), /operation failed/);
    assert.deepEqual(events, ['BEGIN', 'ROLLBACK', brokenRollback]);
  }
});
