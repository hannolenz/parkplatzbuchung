import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'parking-session.json');

function config() {
  return {
    url: process.env.PARKING_URL || 'https://duesseldorf.ergoladesaeulen.de/',
    username: process.env.PARKING_USERNAME,
    password: process.env.PARKING_PASSWORD,
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false'
  };
}

async function launchParkingPage() {
  const { url, username, password, headless } = config();
  if (!username || !password) throw new Error('PARKING_USERNAME und PARKING_PASSWORD fehlen in .env.local.');

  await fs.mkdir(DATA_DIR, { recursive: true });
  const browser = await chromium.launch({ headless });
  const stateExists = await fs.access(STATE_FILE).then(() => true).catch(() => false);
  const context = await browser.newContext(stateExists ? { storageState: STATE_FILE } : {});
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  if (await page.locator('#user_login').count()) {
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    const remember = page.locator('#rememberme');
    if (await remember.count()) await remember.check();
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('#wp-submit').click()
    ]);
    const loginError = page.locator('#login_error');
    if (await loginError.count()) {
      throw new Error(`Login abgelehnt: ${(await loginError.innerText()).replace(/\s+/g,' ').trim()}`);
    }
  }

  if (page.url().includes('wp-login.php')) throw new Error('Login konnte nicht bestätigt werden.');
  await context.storageState({ path: STATE_FILE });
  return { browser, context, page };
}

export async function testParkingLogin() {
  const { browser, page } = await launchParkingPage();
  try {
    return { ok: true, url: page.url(), title: await page.title(), sessionStored: true };
  } finally {
    await browser.close();
  }
}

function slotLabel(slot) {
  return slot === 'afternoon' ? '13:00 Uhr bis 15:00 Uhr' : '07:00 Uhr bis 12:30 Uhr';
}

function isoToParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) throw new Error('Bitte ein gültiges Parkdatum auswählen.');
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

async function selectDateTab(page, date) {
  const p = isoToParts(date);
  const displayDate = `${String(p.d).padStart(2,'0')}.${String(p.m).padStart(2,'0')}.${p.y}`;
  const datePattern = new RegExp(
    `(?:Heute|Morgen)?\\s*\\(?\\s*0?${p.d}\\.0?${p.m}\\.${p.y}\\s*\\)?`,
    'i'
  );

  // Nicht auf einen bestimmten HTML-Tag festlegen: die Datumsreiter können
  // Links, Buttons oder andere klickbare Elemente sein.
  const exactText = page.getByText(datePattern, { exact: false });
  const count = await exactText.count();

  for (let i = 0; i < count; i++) {
    const candidate = exactText.nth(i);
    if (!await candidate.isVisible().catch(() => false)) continue;

    const text = (await candidate.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!text || !datePattern.test(text)) continue;

    try {
      await candidate.click({ timeout: 3000 });
      await page.waitForTimeout(300);
      return text;
    } catch {
      // Falls der Text in einem Kind-Element steckt, das nächste klickbare
      // Elternelement probieren.
      const clickableParent = candidate.locator('xpath=ancestor-or-self::*[self::a or self::button or @role="button"][1]');
      if (await clickableParent.count()) {
        await clickableParent.click({ timeout: 3000 });
        await page.waitForTimeout(300);
        return text;
      }
    }
  }

  throw new Error(
    `Das Parkdatum ${displayDate} wurde auf der ERGO-Seite nicht als auswählbares Datum gefunden. ` +
    `Das bedeutet noch nicht, dass keine Säule frei ist.`
  );
}

async function chooseSlotAndReadStations(page, slot) {
  const selects = page.locator('select');
  if (await selects.count() < 2) throw new Error('Zeitslot- oder Säulen-Auswahl wurde nicht gefunden.');
  const wanted = slotLabel(slot);
  await selects.nth(0).selectOption({ label: wanted });
  await page.waitForTimeout(250);

  const stationSelect = selects.nth(1);
  const options = await stationSelect.locator('option').allTextContents();
  const stations = options.map(t=>t.trim()).filter(t=>/^\d+\s*-\s*/.test(t)).map(text => {
    const m = text.match(/^(\d+)\s*-\s*(.+)$/);
    return { number: m?.[1] || text, status: (m?.[2] || '').trim(), free: /\bfrei\b/i.test(text), label: text };
  });
  return { stationSelect, stations, slotLabel: wanted };
}

function pickStation(stations, priorities=[], fallback=true) {
  const free = stations.filter(s=>s.free);
  for (const number of priorities) {
    const hit = free.find(s=>s.number === String(number));
    if (hit) return hit;
  }
  return fallback ? free[0] || null : null;
}

export async function inspectAvailability({ date, slot='morning', priorities=[], fallback=true }) {
  const { browser, page } = await launchParkingPage();
  try {
    const dateTab = await selectDateTab(page, date);
    const { stations, slotLabel: selectedSlot } = await chooseSlotAndReadStations(page, slot);
    const suggested = pickStation(stations, priorities, fallback);
    return { ok:true, date, dateTab, slot, slotLabel:selectedSlot, stations, suggested };
  } finally {
    await browser.close();
  }
}

export async function reserveParking({ date, slot='morning', priorities=[], fallback=true, expectedStation }) {
  const { browser, page } = await launchParkingPage();
  try {
    const dateTab = await selectDateTab(page, date);
    const { stationSelect, stations, slotLabel: selectedSlot } = await chooseSlotAndReadStations(page, slot);
    const selected = pickStation(stations, priorities, fallback);
    if (!selected) throw new Error('Keine passende freie Ladesäule gefunden.');
    if (expectedStation && String(expectedStation) !== selected.number) {
      throw new Error(`Verfügbarkeit hat sich geändert. Statt ${expectedStation} wäre jetzt ${selected.number} vorgesehen. Bitte erneut prüfen.`);
    }

    await stationSelect.selectOption({ label: selected.label });
    const reserveButton = page.getByRole('button', { name: /reservieren/i }).first();
    if (!await reserveButton.count()) throw new Error('Button „RESERVIEREN“ wurde nicht gefunden.');

    await reserveButton.click();
    await page.waitForTimeout(700);

    const body = (await page.locator('body').innerText()).replace(/\s+/g,' ').trim();
    const stillFreeSelected = await page.locator('select').nth(1).locator('option:checked').innerText().catch(()=> '');
    const successHint = /reserviert|reservierung|erfolgreich|gebucht/i.test(body);
    const noLongerFree = stillFreeSelected && !/\bfrei\b/i.test(stillFreeSelected);

    return {
      ok: true,
      date,
      dateTab,
      slotLabel: selectedSlot,
      station: selected.number,
      verification: successHint ? 'Bestätigung auf der Seite erkannt.' :
                    noLongerFree ? 'Säule wird nach dem Klick nicht mehr als frei angezeigt.' :
                    'Reservierung wurde ausgelöst; die Seite liefert keine eindeutige Textbestätigung.'
    };
  } finally {
    await browser.close();
  }
}
