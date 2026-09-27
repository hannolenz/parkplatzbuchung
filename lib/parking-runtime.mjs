import fs from 'node:fs/promises';
import path from 'node:path';
import { ParkingError } from './parking-domain.mjs';

// A local filesystem shared by all processes is required. Never steal a stale lock:
// a delayed Chromium process could still perform a booking.
export async function withParkingLock(directory, operation) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'operation.lock');
  try {
    await fs.mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new ParkingError('PARKING_BUSY', 'Eine Parkplatzaktion läuft oder ihre Sperre muss nach einem Abbruch geprüft werden.', 409);
    throw error;
  }
  let retainLock = false;
  try {
    return await operation();
  } catch (error) {
    retainLock = error.code === "CLEANUP_FAILED";
    throw error;
  } finally {
    if (!retainLock) await fs.rmdir(lock);
  }
}

export async function withBrowserResources(launch, operation) {
  let browser;
  let context;
  let result;
  let failure;
  let closeFailed = false;
  try {
    browser = await launch();
    result = await operation(browser, value => { context = value; });
  } catch (error) {
    failure = error;
  } finally {
    // Context.close closes all its pages, including any opened popups.
    try { if (context) await context.close(); } catch { closeFailed = true; }
    try { if (browser) await browser.close(); } catch { closeFailed = true; }
  }
  if (closeFailed) throw new ParkingError('CLEANUP_FAILED', 'Browserbereinigung fehlgeschlagen. Vor einer weiteren Aktion lokale Prozesse prüfen.', 500);
  if (failure) throw failure;
  return result;
}

export async function beginAttempt(directory, { date, slot, expectedStation }) {
  const attempts = path.join(directory, 'attempts');
  await fs.mkdir(attempts, { recursive: true, mode: 0o700 });
  const file = path.join(attempts, `${date}-${slot}.json`);
  try {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ date, slot, station: expectedStation, status: 'outcome_unknown', createdAt: new Date().toISOString() }));
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'EEXIST') throw new ParkingError('ATTEMPT_EXISTS', 'Für dieses Datum und diesen Zeitslot besteht bereits ein ungeklärter Buchungsversuch. Zuerst direkt bei ERGO prüfen; nicht erneut buchen.', 409);
    throw error;
  }
}
