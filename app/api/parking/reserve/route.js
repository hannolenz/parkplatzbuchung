import { NextResponse } from 'next/server';
import { reserveParking } from '@/lib/parking';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(request) {
  try {
    const body = await request.json();
    if (body.confirm !== true) return NextResponse.json({ok:false,message:'Reservierung wurde nicht bestätigt.'},{status:400});
    return NextResponse.json(await reserveParking(body));
  } catch (error) {
    console.error('[parking/reserve]', error);
    return NextResponse.json({ok:false,message:error instanceof Error ? error.message : 'Unbekannter Fehler.'},{status:500});
  }
}
