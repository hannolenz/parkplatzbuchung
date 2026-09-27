import expected from './migration-manifest.json' with { type: 'json' };
export async function systemHealth(database) {
  const result = { web: 'reachable', database: 'unreachable', migrations: 'unknown', worker: 'inactive', automaticExecution: false };
  try { await database.query('SELECT 1'); result.database = 'reachable'; } catch { return result; }
  try {
    const { rows } = await database.query('SELECT name, checksum FROM schema_migrations');
    result.migrations = rows.length === expected.length && expected.every(e => rows.some(r => r.name === e.name && r.checksum === e.checksum)) ? 'current' : 'pending';
  } catch (error) { result.migrations = error?.code === '42P01' ? 'pending' : 'unknown'; }
  return result;
}
