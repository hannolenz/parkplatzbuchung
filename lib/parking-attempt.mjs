import { beginAttempt } from './parking-runtime.mjs';

// Dependency injection keeps tests completely offline. There is deliberately no
// success branch until a real ERGO confirmation contract has been established.
export async function runReservationAttempt({ directory, input, capture, save, click, observe }) {
  const { date, slot, expectedStation: station } = input;
  const before = await capture();
  const beforeId = await save({ phase: 'before', date, slot, station, snapshot: before });
  await beginAttempt(directory, input);
  let observation = 'changed';
  let after = null;
  try {
    await click();
    await observe();
  } catch {
    // A timeout cannot tell us whether the server booked. Never retry the click.
    observation = 'click_or_observation_unconfirmed';
  }
  try { after = await capture(); } catch { observation = 'page_unavailable'; }
  let diagnosticId = beforeId;
  let diagnosticSaved = false;
  try {
    diagnosticId = await save({ phase: 'after', beforeId, date, slot, station, observation, snapshot: after });
    diagnosticSaved = true;
  } catch { /* Pre-click diagnosis and persistent attempt marker still exist. */ }
  return {
    ok: false, outcome: 'unknown', code: 'RESERVATION_UNVERIFIED', diagnosticId, diagnosticSaved,
    message: 'Buchungsversuch ohne verifizierten Erfolgsnachweis. Bitte direkt bei ERGO prüfen und nicht erneut buchen. Die lokale Diagnose ist zur Auswertung vorgemerkt.'
  };
}
