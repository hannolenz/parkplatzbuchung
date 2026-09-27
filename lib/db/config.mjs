import { PlanningError } from '../planning/domain.mjs';
export function poolOptions(env = process.env) {
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { /* Safe error below. */ }
  const fail = () => { throw new PlanningError('DATABASE_CONFIGURATION', 'Datenbankkonfiguration ungültig.', 503); };
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol)) fail();
  // Avoid node-postgres URL options silently overriding certificate validation.
  if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl'))) fail();
  const production = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
  const mode = env.DATABASE_SSL || 'verify-full';
  if (!['verify-full','disable'].includes(mode)) fail();
  if (mode === 'disable' && (production || !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) fail();
  const max = env.DATABASE_POOL_MAX || '3';
  if (!/^(?:[1-9]|10)$/.test(max)) fail();
  return { connectionString: env.DATABASE_URL, max: Number(max), ssl: mode === 'disable' ? false : { rejectUnauthorized: true, ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, '\n') } : {}) },
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000, maxLifetimeSeconds: 300, allowExitOnIdle: true,
    statement_timeout: 10000, query_timeout: 12000, idle_in_transaction_session_timeout: 15000 };
}
