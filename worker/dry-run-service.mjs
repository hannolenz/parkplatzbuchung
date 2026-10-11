// No browser or real reservation adapter. Optional read-only inspection is injected.
export async function runDryRunOnce(repository, { workerId = 'local-dry-run', instanceId = null, signal,
  simulate = async () => {}, inspect, log = entry => console.log(JSON.stringify(entry)) } = {}) {
  if (signal?.aborted) return { claimed: false };
  const claim = await repository.claimDue(workerId, instanceId);
  if (!claim) return { claimed: false };
  try {
    if (signal?.aborted) throw new Error('STOPPING');
    await repository.start(claim);
    const availability = inspect ? await inspect(claim.input) : null;
    const selectedStation = availability?.suggested?.number || null;
    log({ event: 'would_reserve', mode: 'dry_run', bookingId: claim.bookingId, attemptId: claim.attemptId,
      parkingDate: claim.input.parkingDate, slot: claim.input.slot, stationPriorities: claim.input.stationPriorities,
      allowFallback: claim.input.allowFallback, selectedStation });
    if (signal?.aborted) throw new Error('STOPPING');
    await repository.markSimulatedCritical(claim);
    await simulate(); // Empty production simulator; fault injection only in automated tests.
    await repository.finishDryRun(claim);
    return { claimed: true, bookingId: claim.bookingId, outcome: 'simulated', booked: false, selectedStation };
  } catch {
    try { await repository.failDryRun(claim); } catch { /* Persisted lease/phase allows later recovery. */ }
    throw new Error('DRY_RUN_FAILED');
  }
}
