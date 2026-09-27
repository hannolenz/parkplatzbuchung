import { planningRoute, readPlanningJson } from '@/lib/planning/http.mjs';
import { planningService } from '@/lib/planning/server.mjs';
import { planningConfiguration } from '@/lib/planning/service.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = planningRoute(async () => {
  const configuration = planningConfiguration();
  return { configuration, bookings: configuration.databaseConfigured ? await planningService().list() : [] };
});
export const POST = planningRoute(async request => ({ booking: await planningService().create(await readPlanningJson(request)) }));
