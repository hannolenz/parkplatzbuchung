// Future live policy is pure decision logic, never an execution adapter.
export function recoveryDecision({ mode = 'dry_run', phase, evidence = 'none' }) {
  if (evidence === 'confirmed_success') return mode === 'dry_run'
    ? { status: 'simulated', retryEligible: false }
    : { status: 'booked', retryEligible: false };
  if (phase === 'before_critical' || evidence === 'confirmed_no_reservation') return { status: 'failed', retryEligible: true };
  return { status: 'unknown', retryEligible: false };
}
