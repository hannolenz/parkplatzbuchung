import { runDryRunOnce } from './dry-run-service.mjs';
import { ErgoReadError } from '../lib/ergo-http/domain.mjs';
const inputFor = plan => ({ date: plan.parkingDate, slot: plan.slot, priorities: plan.stationPriorities, fallback: plan.allowFallback });
// Adapter injection makes the worker boundary testable without network or DB.
// prepareSession can be called ahead of time; readPlan always loads fresh data.
export function createHttpPreviewService(adapter, { mode } = {}) {
  if (mode !== 'dry-run') throw new ErgoReadError('DRY_RUN_MODE_REQUIRED');
  const readPlan = plan => adapter.inspectAvailability(inputFor(plan));
  return Object.freeze({
    prepareSession: () => adapter.prepareSession(),
    readPlan,
    runJob: (repository, options) => runDryRunOnce(repository, { ...options, inspect: readPlan })
  });
}
