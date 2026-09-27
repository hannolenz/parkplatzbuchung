import { NextResponse } from 'next/server';
import { inspectAvailability } from '@/lib/parking';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json(await inspectAvailability(body));
  } catch (error) {
    console.error('[parking/availability]', error);
    return NextResponse.json({ok:false,message:error instanceof Error ? error.message : 'Unbekannter Fehler.'},{status:500});
  }
}
