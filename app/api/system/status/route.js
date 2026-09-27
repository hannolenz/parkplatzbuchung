import { planningRoute } from '@/lib/planning/http.mjs';
import { systemHealth } from '@/lib/db/health.mjs';
import { getDatabase } from '@/lib/db/connection.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = planningRoute(async () => systemHealth(getDatabase()));
