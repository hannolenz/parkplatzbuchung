import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ParkingError, isoToParts, validateInput, pickStation } from './parking-domain.mjs';
import { withParkingLock, withBrowserResources } from './parking-runtime.mjs';
import { captureDiagnostic, saveDiagnostic } from './parking-diagnostics.mjs';
import { runReservationAttempt } from './parking-attempt.mjs';
import { chooseSlotAndReadStations } from './parking-selects.mjs';
import { trackReservationDialogs } from './parking-dialogs.mjs';
import { collectDiagnosticSecrets } from './parking-secrets.mjs';

const DATA_DIR = path.join(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'parking-session.json');

function config() {
  const url = new URL(process.env.PARKING_URL || 'https://duesseldorf.ergoladesaeulen.de/');
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new ParkingError('INVALID_CONFIG', 'PARKING_URL muss eine HTTPS-Adresse ohne eingebettete Zugangsdaten sein.', 500);
  }
  const username = process.env.PARKING_USERNAME;
  const password = process.env.PARKING_PASSWORD;
  if (!username || !password) throw new ParkingError('MISSING_CONFIG', 'PARKING_USERNAME und PARKING_PASSWORD fehlen in der Serverumgebung.', 500);
  return { url: url.href, origin: url.origin, username, password, headless: process.env.PLAYWRIGHT_HEADLESS !== 'false' };
}

async function withParkingPage(operation) {
  const settings = config();
  return withParkingLock(DATA_DIR, () => withBrowserResources(
    () => chromium.launch({ headless: settings.headless, timeout: 30000 }),
    async (browser, registerContext) => {
      const stateExists = await fs.access(STATE_FILE).then(() => true).catch(() => false);
      const context = await browser.newContext(stateExists ? { storageState: STATE_FILE } : {});
      registerContext(context);
      context.setDefaultTimeout(15000);
      context.setDefaultNavigationTimeout(30000);
      const page = await context.newPage();
      await page.goto(settings.url, { waitUntil: 'domcontentloaded' });
      await page.locator('#user_login, select').first().waitFor({ state: 'visible' });
      if (await page.locator('#user_login').isVisible()) {
        await page.locator('#user_login').fill(settings.username);
        await page.locator('#user_pass').fill(settings.password);
        if (await page.locator('#rememberme').count()) await page.locator('#rememberme').check();
        await page.locator('#wp-submit').click();
        await page.waitForFunction(() => {
          const error = document.querySelector('#login_error');
          const form = document.querySelector('#user_login');
          return Boolean(error?.getClientRects().length) || (!form?.getClientRects().length && document.querySelector('select'));
        });
        if (await page.locator('#login_error').isVisible()) {
          throw new ParkingError('LOGIN_FAILED', 'Login wurde von ERGO abgelehnt.', 502);
        }
      }
      if (new URL(page.url()).pathname.endsWith('/wp-login.php')) throw new ParkingError('LOGIN_FAILED', 'Login konnte nicht bestätigt werden.', 502);
      await page.locator('select').nth(1).waitFor({ state: 'visible' });
      // Atomic session replacement; the lock covers readers and writers alike.
      const temporary = `${STATE_FILE}.${randomUUID()}.tmp`;
      try {
        const state = await context.storageState();
        await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, STATE_FILE);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return operation(page, settings);
    }
  ));
}

export async function testParkingLogin() {
  return withParkingPage(async () => ({ ok: true, sessionStored: true }));
}

async function waitForSelectionControls(page) {
  await page.waitForFunction(() => {
    const selects = document.querySelectorAll('select');
    return selects.length >= 2 && [...selects].slice(0, 2).every(el => !el.disabled && el.getClientRects().length > 0 && el.options.length > 0);
  });
}

async function selectDateTab(page, date) {
  const { y, m, d } = isoToParts(date);
  // Boundaries avoid matching 1.8.2026 inside 11.8.2026.
  const pattern = new RegExp(`(?:^|[^\\d])0?${d}\\.0?${m}\\.${y}(?!\\d)`);
  const candidates = page.getByText(pattern);
  await candidates.first().waitFor({ state: 'visible' });
  for (let i = 0; i < await candidates.count(); i++) {
    const candidate = candidates.nth(i);
    if (!await candidate.isVisible()) continue;
    const parent = candidate.locator('xpath=ancestor-or-self::*[self::a or self::button or @role="button"][1]');
    await (await parent.count() ? parent : candidate).click();
    await waitForSelectionControls(page);
    // This confirms operable controls, not the site's active date semantics.
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  }
  throw new ParkingError('DATE_UNAVAILABLE', 'Das Parkdatum ist auf der ERGO-Seite nicht auswählbar.', 409);
}

export async function inspectAvailability(input) {
  const { date, slot, priorities, fallback } = validateInput(input);
  return withParkingPage(async page => {
    const dateTab = await selectDateTab(page, date);
    const { stations, slotLabel: selectedSlot } = await chooseSlotAndReadStations(page, slot);
    const suggested = pickStation(stations, priorities, fallback);
    // Do not return raw option text: booked options may contain personal details.
    const publicStation = station => station ? { number: station.number, status: station.status, free: station.free } : null;
    return { ok: true, date, dateTab, slot, slotLabel: selectedSlot, stations: stations.map(publicStation), suggested: publicStation(suggested) };
  });
}

export async function reserveParking(input) {
  const validated = validateInput(input, true);
  const { date, slot, priorities, fallback, expectedStation } = validated;
  return withParkingPage(async (page, settings) => {
    const secrets = [settings.username, settings.password];
    const dialogs = trackReservationDialogs(page, { secrets });
    try {
      dialogs.addSecrets(await collectDiagnosticSecrets(page, secrets));
      await selectDateTab(page, date);
      const { stationSelect, stations } = await chooseSlotAndReadStations(page, slot);
      const selected = pickStation(stations, priorities, fallback);
      if (!selected) throw new ParkingError('NO_STATION', 'Keine passende freie Ladesäule gefunden.', 409);
      if (expectedStation !== selected.number) throw new ParkingError('STATION_CHANGED', 'Verfügbarkeit hat sich geändert. Bitte erneut prüfen.', 409);
      await stationSelect.selectOption({ label: selected.label });
      const button = page.getByRole('button', { name: /^\s*reservieren\s*$/i });
      // Never pick an arbitrary button if the page contains multiple matches.
      await button.waitFor({ state: 'visible' });
      await button.click({ trial: true });
      dialogs.addSecrets(await collectDiagnosticSecrets(page, secrets));
      const baseline = await page.evaluate(() => ({ text: document.body.innerText, url: location.href }));
      return await runReservationAttempt({
        directory: DATA_DIR,
        input: validated,
        capture: () => captureDiagnostic(page, secrets, settings.origin),
        save: async data => saveDiagnostic(DATA_DIR, { ...data, dialogs: await dialogs.snapshot() }),
        click: async () => {
          dialogs.markClickStarted();
          try { await button.click(); }
          finally { dialogs.markClickFinished(); }
        },
        observe: () => page.waitForFunction(previous => document.body?.innerText !== previous.text || location.href !== previous.url, baseline, { timeout: 10000 })
      });
    } finally {
      await dialogs.dispose();
    }
  });
}
