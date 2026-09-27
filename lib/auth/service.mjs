import { AuthError, authConfig, digestToken, readSessionCookie, newToken, verifyPassword, sessionCookie, assertOrigin } from './core.mjs';
export function createAuthService(repository, { env = process.env } = {}) {
  return {
    async requireSession(headers) {
      const config = authConfig(env);
      const token = readSessionCookie(headers, config.production);
      if (!token || !await repository.validSession(digestToken(token), config.credentialVersion)) throw new AuthError('UNAUTHENTICATED', 'Bitte anmelden.', 401);
      return { authenticated: true };
    },
    async login(request, body) {
      assertOrigin(request, env);
      const config = authConfig(env);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['username','password'].includes(k)) ||
          typeof body.username !== 'string' || body.username.length > 128 || typeof body.password !== 'string' || Buffer.byteLength(body.password) > 1024) throw new AuthError('INVALID_LOGIN', 'Ungültige Anmeldung.', 400);
      if (!await repository.consumeLoginAttempt()) throw new AuthError('LOGIN_LIMIT', 'Zu viele Anmeldeversuche. Bitte nach 15 Minuten erneut versuchen.', 429);
      // Password work happens for both correct and incorrect usernames.
      const passwordOK = await verifyPassword(body.password, config.passwordHash);
      if (!passwordOK || body.username !== config.username) throw new AuthError('LOGIN_FAILED', 'Anmeldung fehlgeschlagen.', 401);
      const token = newToken();
      const old = readSessionCookie(request.headers, config.production);
      await repository.replaceSession(old ? digestToken(old) : null, digestToken(token), config.credentialVersion);
      return sessionCookie(token, config.production);
    },
    async logout(request) {
      assertOrigin(request, env);
      const config = authConfig(env);
      const token = readSessionCookie(request.headers, config.production);
      if (token) await repository.revoke(digestToken(token));
      return sessionCookie('', config.production, true);
    }
  };
}
