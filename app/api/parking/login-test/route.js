import { testParkingLogin } from '@/lib/parking';
import { parkingPost } from '@/lib/parking-api.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = parkingPost(testParkingLogin, { body: false });
