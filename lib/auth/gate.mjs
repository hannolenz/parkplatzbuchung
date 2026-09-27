import { requireSessionRequest, authFailure } from './server.mjs';
// Protect all page/API paths. Only the login and framework static assets are public.
export async function gateRequest(request, authenticate = requireSessionRequest) {
  const path = new URL(request.url).pathname;
  if (path === '/login' || path === '/api/auth/login' || path === '/api/auth/logout' || path.startsWith('/_next/static/') || path === '/favicon.ico') return null;
  try { await authenticate(request); return null; }
  catch (error) {
    if (path.startsWith('/api/')) return authFailure(error);
    return new Response(null, { status: 303, headers: { Location: new URL('/login', request.url).href, 'Cache-Control': 'no-store' } });
  }
}
