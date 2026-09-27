import { planningRoute, readPlanningJson } from '@/lib/planning/http.mjs';
import { planningService } from '@/lib/planning/server.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const PATCH = planningRoute(async (request, context) => {
  const { id } = await context.params;
  return { booking: await planningService().update(id, await readPlanningJson(request)) };
});
export const DELETE = planningRoute(async (request, context) => {
  const { id } = await context.params;
  return { booking: await planningService().cancel(id, await readPlanningJson(request)) };
});
