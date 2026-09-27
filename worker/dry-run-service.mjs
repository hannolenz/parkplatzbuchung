// Deliberately no import of Playwright, parking.js or the real reservation routes.
export async function runDryRunOnce(repository, { workerId = 'local-dry-run', log = entry => console.log(JSON.stringify(entry)) } = {}) {
  const claim = await repository.claimDue(workerId);
  if (!claim) return { claimed: false };
  try {
    await repository.start(claim);
    log({ event: 'would_reserve', mode: 'dry_run', bookingId: claim.bookingId, attemptId: claim.attemptId,
      parkingDate: claim.input.parkingDate, slot: claim.input.slot, stationPriorities: claim.input.stationPriorities,
      allowFallback: claim.input.allowFallback, selectedStation: null });
    await repository.finishDryRun(claim);
    return { claimed: true, bookingId: claim.bookingId, outcome: 'simulated', booked: false };
  } catch {
    await repository.failDryRun(claim);
    throw new Error('DRY_RUN_FAILED');
  }
}
