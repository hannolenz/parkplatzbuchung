import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authService } from './server.mjs';
export async function requirePageSession() {
  let allowed = false;
  try { await authService().requireSession(await headers()); allowed = true; } catch { /* Do not expose DB errors in page rendering. */ }
  if (!allowed) redirect('/login');
}
