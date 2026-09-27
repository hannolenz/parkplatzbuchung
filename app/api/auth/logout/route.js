import { authHandlers } from '@/lib/auth/http.mjs';
export const runtime = 'nodejs';
export const POST = authHandlers().logout;
