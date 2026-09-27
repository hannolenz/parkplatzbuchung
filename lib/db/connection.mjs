import pg from 'pg';
import { PlanningError } from '../planning/domain.mjs';
import { poolOptions } from './config.mjs';
import { attachDatabasePool } from '@vercel/functions';
const cacheKey = Symbol.for('parkplatzbuchung.database');
export function createDatabase(pool) {
  return {
    query: (text, values) => pool.query(text, values),
    async transaction(operation) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
        throw error;
      } finally { client.release(discard); }
    },
    close: () => pool.end()
  };
}
export function getDatabase() {
  if (!process.env.DATABASE_URL) throw new PlanningError('DATABASE_NOT_CONFIGURED', 'DATABASE_URL ist noch nicht eingerichtet.', 503);
  if (!globalThis[cacheKey]) {
    const pool = new pg.Pool(poolOptions());
    pool.on('error', () => { /* No raw database error output; callers return safe errors. */ });
    if (process.env.VERCEL) attachDatabasePool(pool);
    globalThis[cacheKey] = createDatabase(pool);
  }
  return globalThis[cacheKey];
}
