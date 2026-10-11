import { isoToParts, validateInput, pickStation } from '../parking-domain.mjs';
export class ErgoReadError extends Error {
  constructor(code) { super(code); this.name = 'ErgoReadError'; this.code = code; }
}
const fail = code => { throw new ErgoReadError(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const stationId = v => typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v);
export function resolveErgoDay(parkingDate, now, timezone = 'Europe/Berlin') {
  try { isoToParts(parkingDate); } catch { fail('INVALID_DATE'); }
  if (timezone !== 'Europe/Berlin' || !(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_CLOCK');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  // Calendar arithmetic on the date components, not 24h from the current instant.
  const tomorrow = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day + 1)).toISOString().slice(0, 10);
  if (parkingDate === today) return true;
  if (parkingDate === tomorrow) return false;
  fail('DATE_NOT_AVAILABLE');
}
export function assertAutomaticTomorrow(parkingDate, now) {
  if (resolveErgoDay(parkingDate, now) !== false) fail('AUTOMATIC_REQUIRES_TOMORROW');
  return false; // Guard only; no execution capability.
}
function minute(hour, min) {
  if (!Number.isInteger(hour) || !Number.isInteger(min) || hour < 0 || hour > 24 || min < 0 || min > 59 || (hour === 24 && min !== 0)) fail('INVALID_RESPONSE');
  return hour * 60 + min;
}
function interval(tuple) {
  if (!Array.isArray(tuple) || tuple.length !== 4) fail('INVALID_RESPONSE');
  const start = minute(tuple[0], tuple[1]), end = minute(tuple[2], tuple[3]);
  if (start >= end) fail('INVALID_RESPONSE');
  return [start, end];
}
export function intervalsOverlap(a, b) {
  for (const v of [a, b]) if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite) || v[0] >= v[1]) fail('INVALID_INTERVAL');
  return a[0] < b[1] && b[0] < a[1];
}
export function decodeOccupancy(text) {
  try {
    const outer = JSON.parse(text);
    if (typeof outer !== 'string') fail('INVALID_RESPONSE');
    const data = JSON.parse(outer);
    if (!object(data)) fail('INVALID_RESPONSE');
    return data;
  } catch { fail('INVALID_RESPONSE'); }
}
export function validateReadInput(input) {
  try { return validateInput(input); } catch { fail('INVALID_INPUT'); }
}
export function calculateAvailability(config, occupancy, input, today) {
  const valid = validateReadInput(input);
  if (!object(config) || !object(config.saeulen) || !object(config.zeiten) || typeof config.morgenBuchen !== 'boolean') fail('INVALID_RESPONSE');
  if (!today && !config.morgenBuchen) fail('TOMORROW_DISABLED');
  const ids = Object.keys(config.saeulen);
  if (!ids.length || ids.length > 1000 || ids.some(id => !stationId(id) || !stationId(config.saeulen[id])) || new Set(Object.values(config.saeulen)).size !== ids.length) fail('INVALID_RESPONSE');
  const times = config.zeiten;
  if (!Number.isInteger(times.startStunde) || !Number.isInteger(times.endStunde) || times.startStunde < 0 || times.endStunde > 24 || times.startStunde >= times.endStunde || !Number.isInteger(times.maxLaengeMinuten) || times.maxLaengeMinuten <= 0 || !object(times.slots) || times.slots.slotsAllowed !== true || !Array.isArray(times.slots.slots) || times.slots.slots.length > 100) fail('INVALID_RESPONSE');
  for (const slot of times.slots.slots) interval(slot);
  const wanted = valid.slot === 'morning' ? [7, 0, 12, 30] : [13, 0, 15, 0];
  const period = interval(wanted);
  if (!times.slots.slots.some(t => t.every((n, i) => n === wanted[i])) || period[0] < times.startStunde * 60 || period[1] > times.endStunde * 60 || period[1] - period[0] > times.maxLaengeMinuten) fail('SLOT_NOT_AVAILABLE');
  if (!object(occupancy) || !Number.isSafeInteger(occupancy.user_id) || occupancy.user_id < 0 || Object.keys(occupancy).length !== ids.length + 1 || Object.keys(occupancy).some(k => k !== 'user_id' && !ids.includes(k))) fail('INVALID_RESPONSE');
  let chargingExcluded = 0;
  const stations = ids.map(id => {
    const entry = occupancy[id];
    if (!object(entry) || typeof entry.isCharging !== 'boolean' || !Array.isArray(entry.reservations) || entry.reservations.length > 10000) fail('INVALID_RESPONSE');
    let occupied = false;
    for (const row of entry.reservations) {
      if (!Array.isArray(row) || row.length !== 5 || !Number.isSafeInteger(row[4]) || row[4] < 0) fail('INVALID_RESPONSE');
      if (intervalsOverlap(period, interval(row.slice(0, 4)))) occupied = true;
    }
    // Meaning not yet established. Never silently equate isCharging with bookable.
    if (entry.isCharging) chargingExcluded++;
    const free = !occupied && !entry.isCharging;
    return { id, number: config.saeulen[id], free, status: free ? 'frei' : 'nicht verfügbar', reason: entry.isCharging ? 'CHARGING_UNVERIFIED' : occupied ? 'OCCUPIED' : null };
  });
  return { date: valid.date, slot: valid.slot, today, stations, suggested: pickStation(stations, valid.priorities, valid.fallback), chargingExcluded, booked: false, mode: 'read-only' };
}
