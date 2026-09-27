import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export class AuthError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}
export const SESSION_SECONDS = 8 * 60 * 60;
export function authConfig(env = process.env) {
  const username = env.APP_AUTH_USERNAME;
  const passwordHash = env.APP_AUTH_PASSWORD_HASH;
  let origin;
  try { origin = new URL(env.APP_AUTH_ORIGIN); } catch { /* Fail closed below. */ }
  const production = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
  if (!username || username.length > 128 || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash || '') ||
      !origin || origin.origin !== env.APP_AUTH_ORIGIN || origin.username || origin.password ||
      (origin.protocol !== 'https:' && (production || origin.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))) {
    throw new AuthError('AUTH_NOT_CONFIGURED', 'Web-Anmeldung ist noch nicht vollständig eingerichtet.', 503);
  }
  return { username, passwordHash, origin: origin.origin, production,
    credentialVersion: createHash('sha256').update(username + '\0' + passwordHash).digest('hex') };
}
export function digestToken(token) { return createHash('sha256').update(token).digest('hex'); }
export function validToken(token) { return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 16 || Buffer.byteLength(password) > 1024) throw new Error('Password must contain at least 16 characters and at most 1024 bytes.');
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${salt}:${derived.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024) return false;
  const [, salt, expected] = encoded.split(':');
  const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function cookieName(production) { return production ? '__Host-parking_session' : 'parking_session'; }
export function readSessionCookie(headers, production) {
  const name = cookieName(production);
  const entries = (headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (entries.length !== 1) return null;
  const value = entries[0].slice(name.length + 1);
  return validToken(value) ? value : null;
}
export function sessionCookie(token, production, remove = false) {
  return `${cookieName(production)}=${remove ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : SESSION_SECONDS}${production ? '; Secure' : ''}`;
}
export function assertOrigin(request, env = process.env) {
  const url = new URL(request.url);
  const expected = env.APP_AUTH_ORIGIN || (!env.VERCEL && env.NODE_ENV !== 'production' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? url.origin : null);
  if (!expected || request.headers.get('origin') && request.headers.get('origin') !== expected ||
      !['GET','HEAD'].includes(request.method) && request.headers.get('origin') !== expected ||
      ['cross-site','same-site'].includes(request.headers.get('sec-fetch-site'))) {
    throw new AuthError('ORIGIN_DENIED', 'Anfrage aus einem nicht erlaubten Ursprung.', 403);
  }
}
