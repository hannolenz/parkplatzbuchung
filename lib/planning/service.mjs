import { getSchedulingRule, validatePlan, validateId, validateCancellation } from './domain.mjs';
export function planningConfiguration(env = process.env) {
  let rule = null;
  try { rule = getSchedulingRule(env); } catch { /* Expose only setup state, never connection details. */ }
  return { databaseConfigured: Boolean(env.DATABASE_URL), schedulingConfigured: Boolean(rule), rule, executionMode: 'dry_run' };
}
export function createPlanningService(repository, { env = process.env, now = () => new Date() } = {}) {
  return {
    list: () => repository.list(),
    create: body => repository.create(validatePlan(body, getSchedulingRule(env), { now: now() })),
    update: (id, body) => repository.update(validateId(id), validatePlan(body, getSchedulingRule(env), { now: now(), editing: true })),
    cancel: (id, body) => repository.cancel(validateId(id), validateCancellation(body))
  };
}
