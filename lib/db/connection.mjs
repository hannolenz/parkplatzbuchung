import pg from 'pg';
import { PlanningError } from '../planning/domain.mjs';
let database;
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
  if (!database) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 10000 });
    pool.on('error', () => { /* No raw database error output; callers return safe errors. */ });
    database = createDatabase(pool);
  }
  return database;
}
