import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chooseSlotAndReadStations } from '../lib/parking-selects.mjs';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, { initial = '<option>Bitte zuerst einen Zeitslot auswählen</option>', loaded = '<option>Säule auswählen</option><option value="1181">1181 - frei</option><option value="1183" disabled>1183 - frei</option><option value="1185">1185 - nicht frei</option>', update = true } = {}) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  await page.setContent(`<select id="saeulennr-report-select"><option>9999 - frei</option></select>
    <select id="slots-select"><option>Zeitslot auswählen</option><option>13:00 Uhr bis 15:00 Uhr</option></select>
    <select id="saeulennr-select">${initial}</select>
    <button onclick="window.reservationClicked=true">RESERVIEREN</button>`);
  if (update) await page.evaluate(loaded => {
    document.querySelector('#slots-select').addEventListener('change', () => {
      // Deliberately delayed fixture response reproduces ERGO's AJAX race.
      setTimeout(() => { document.querySelector('#saeulennr-select').innerHTML = loaded; }, 80);
    });
  }, loaded);
  return page;
}
test('waits for delayed station options and ignores unrelated selects', async t => {
  const page = await fixture(t);
  const result = await chooseSlotAndReadStations(page, 'afternoon');
  assert.deepEqual(result.stations.map(s => s.number), ['1181', '1183', '1185']);
  assert.deepEqual(result.stations.map(s => s.free), [true, false, false]);
  assert.equal(await page.evaluate(() => !!window.reservationClicked), false);
  assert.equal(await page.evaluate(() => Object.keys(window).filter(k => k.startsWith('parkingRead_')).length), 0);
});
test('old station entries must not count as refreshed availability', async t => {
  const page = await fixture(t, { initial: '<option>1113 - frei</option>' });
  const result = await chooseSlotAndReadStations(page, 'afternoon');
  assert.equal(result.stations[0].number, '1181');
});
test('placeholder without an AJAX update fails instead of returning zero stations', async t => {
  const page = await fixture(t, { update: false });
  const originalWait = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, arg, options) => originalWait(fn, arg, { ...options, timeout: 150 });
  await assert.rejects(chooseSlotAndReadStations(page, 'afternoon'), { name: 'TimeoutError' });
  assert.equal(await page.evaluate(() => Object.keys(window).filter(k => k.startsWith('parkingRead_')).length), 0);
});
test('a loaded list containing only occupied stations is a valid result', async t => {
  const page = await fixture(t, { loaded: '<option>Säule auswählen</option><option>1181 - belegt</option>' });
  const result = await chooseSlotAndReadStations(page, 'afternoon');
  assert.equal(result.stations.length, 1);
  assert.equal(result.stations[0].free, false);
});
