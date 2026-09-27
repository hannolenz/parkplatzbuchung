import { randomUUID } from 'node:crypto';
import { slotLabel, parseStation } from './parking-domain.mjs';

export async function chooseSlotAndReadStations(page, slot) {
  const slotSelect = page.locator('#slots-select');
  const stationSelect = page.locator('#saeulennr-select');
  const wanted = slotLabel(slot);
  await slotSelect.waitFor({ state: 'visible' });
  await stationSelect.waitFor({ state: 'visible' });
  const key = `parkingRead_${randomUUID().replaceAll('-', '')}`;
  // Install before selectOption: ERGO replaces the options asynchronously after
  // the change event. Existing placeholders/old options are not a loaded result.
  await page.evaluate(key => {
    const initial = document.querySelector('#saeulennr-select');
    const state = { changed: false };
    state.observer = new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        return target === initial || initial.contains(target) || target?.closest('#saeulennr-select') ||
          [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.id === 'saeulennr-select' || node.querySelector('#saeulennr-select')));
      })) state.changed = true;
    });
    state.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window[key] = state;
  }, key);
  try {
    await slotSelect.selectOption({ label: wanted });
    await page.waitForFunction(({ key, wanted }) => {
      const slots = document.querySelector('#slots-select');
      const stations = document.querySelector('#saeulennr-select');
      return window[key]?.changed && slots?.selectedOptions[0]?.textContent?.trim() === wanted &&
        stations && !stations.disabled && stations.getClientRects().length > 0 &&
        [...stations.options].some(option => /^\d{1,10}\s*-\s*.+$/.test(option.textContent.trim()));
    }, { key, wanted }, { timeout: 15000 });
    const options = await stationSelect.locator('option').evaluateAll(options => options.map(option => ({ text: option.textContent, disabled: option.disabled })));
    const stations = options.map(option => {
      const station = parseStation(option.text);
      return station ? { ...station, free: station.free && !option.disabled, status: station.free && !option.disabled ? 'frei' : 'nicht verfügbar' } : null;
    }).filter(Boolean);
    return { stationSelect, stations, slotLabel: wanted };
  } finally {
    await page.evaluate(key => { window[key]?.observer.disconnect(); delete window[key]; }, key).catch(() => {});
  }
}
