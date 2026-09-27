import { NextResponse } from 'next/server';
import { testParkingLogin } from '@/lib/parking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await testParkingLogin();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[parking/login-test]', error);
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Unbekannter Fehler.' },
      { status: 500 }
    );
  }
}
