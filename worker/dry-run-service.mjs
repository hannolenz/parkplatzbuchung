// No browser, network client, Playwright or real reservation adapter is imported.
export async function runDryRunOnce(repository, { workerId = 'local-dry-run', instanceId = null, signal,
  simulate = async () => {}, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  if (signal?.aborted) return { claimed: false };
  const claim = await repository.claimDue(workerId, instanceId);
  if (!claim) return { claimed: false };
  try {
    if (signal?.aborted) throw new Error('STOPPING');
    await repository.start(claim);
    log({ event: 'would_reserve', mode: 'dry_run', bookingId: claim.bookingId, attemptId: claim.attemptId,
      parkingDate: claim.input.parkingDate, slot: claim.input.slot, stationPriorities: claim.input.stationPriorities,
      allowFallback: claim.input.allowFallback, selectedStation: null });
    if (signal?.aborted) throw new Error('STOPPING');
    await repository.markSimulatedCritical(claim);
    await simulate(); // Empty production simulator; fault injection only in automated tests.
    await repository.finishDryRun(claim);
    return { claimed: true, bookingId: claim.bookingId, outcome: 'simulated', booked: false };
  } catch {
    try { await repository.failDryRun(claim); } catch { /* Persisted lease/phase allows later recovery. */ }
    throw new Error('DRY_RUN_FAILED');
  }
}
