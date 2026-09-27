export class ParkingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function isoToParts(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ParkingError('INVALID_DATE', 'Bitte ein gültiges Parkdatum auswählen.');
  }
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (y < 2000 || y > 9999 || parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) {
    throw new ParkingError('INVALID_DATE', 'Bitte ein gültiges Kalenderdatum auswählen.');
  }
  return { y, m, d };
}

export function slotLabel(slot) {
  if (slot === 'morning') return '07:00 Uhr bis 12:30 Uhr';
  if (slot === 'afternoon') return '13:00 Uhr bis 15:00 Uhr';
  throw new ParkingError('INVALID_SLOT', 'Der Zeitslot ist ungültig.');
}

function stationNumber(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) {
    throw new ParkingError('INVALID_STATION', 'Säulennummern müssen positive Ganzzahlen als Text sein (maximal 10 Stellen).');
  }
  return value;
}

export function validateInput(input, reservation = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ParkingError('INVALID_INPUT', 'Ein JSON-Objekt wird erwartet.');
  }
  const allowed = ['date', 'slot', 'priorities', 'fallback', ...(reservation ? ['confirm', 'expectedStation'] : [])];
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw new ParkingError('INVALID_INPUT', 'Unbekannte Eingabefelder.');
  }
  isoToParts(input.date);
  slotLabel(input.slot);
  if (!Array.isArray(input.priorities) || input.priorities.length > 100) {
    throw new ParkingError('INVALID_PRIORITIES', 'Maximal 100 Säulen als Prioritätenliste übergeben.');
  }
  const priorities = [...new Set(input.priorities.map(stationNumber))];
  if (typeof input.fallback !== 'boolean') {
    throw new ParkingError('INVALID_FALLBACK', 'Fallback muss true oder false sein.');
  }
  if (reservation && input.confirm !== true) {
    throw new ParkingError('CONFIRMATION_REQUIRED', 'Reservierung wurde nicht bestätigt.');
  }
  return {
    date: input.date, slot: input.slot, priorities, fallback: input.fallback,
    ...(reservation ? { confirm: true, expectedStation: stationNumber(input.expectedStation) } : {})
  };
}

export function parseStation(text) {
  const match = /^(\d{1,10})\s*-\s*(.+)$/.exec(text.trim());
  if (!match || !/^[1-9]\d*$/.test(match[1])) return null;
  // Fail closed: „nicht frei“ must never match the positive state.
  const status = match[2].trim();
  return { number: match[1], status: /^frei$/i.test(status) ? 'frei' : 'nicht verfügbar', free: /^frei$/i.test(status), label: text.trim() };
}

export function pickStation(stations, priorities = [], fallback = true) {
  const free = stations.filter(station => station.free === true);
  for (const number of priorities) {
    const hit = free.find(station => station.number === number);
    if (hit) return hit;
  }
  return fallback ? free[0] || null : null;
}
