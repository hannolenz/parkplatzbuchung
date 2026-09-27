import { NextResponse } from 'next/server';
import { gateRequest } from './lib/auth/gate.mjs';
export async function proxy(request) {
  const response = await gateRequest(request) || NextResponse.next();
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export const config = { matcher: ['/((?!_next/static/).*)'] };
