import { getDatabase } from '../db/connection.mjs';
import { authRepository } from './repository.mjs';
import { createAuthService } from './service.mjs';
import { PlanningError } from '../planning/domain.mjs';
import { authConfig, AuthError } from './core.mjs';
export function authService() {
  authConfig(); // Check configuration before opening a connection.
  return createAuthService(authRepository(getDatabase()));
}
export async function requireSessionRequest(request) { return authService().requireSession(request.headers); }
export function authFailure(error) {
  const known = error instanceof AuthError || error instanceof PlanningError;
  return Response.json({ ok: false, code: known ? error.code : 'AUTH_UNAVAILABLE', message: known ? error.message : 'Anmeldung vorübergehend nicht verfügbar.' },
    { status: known ? error.status : 503, headers: { 'Cache-Control': 'no-store', ...(error?.status === 429 ? { 'Retry-After': '900' } : {}) } });
}
