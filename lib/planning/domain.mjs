import { isoToParts, validateInput } from '../parking-domain.mjs';

export class PlanningError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const TIME_ZONE = 'Europe/Berlin';
export const EXECUTION_TIME = '00:01';
export const STATUSES = ['planned', 'preparing', 'running', 'booked', 'failed', 'unknown', 'cancelled'];

export function getSchedulingRule(env = process.env) {
  const raw = env.BOOKING_RELEASE_LEAD_DAYS;
  if (typeof raw !== 'string' || !/^(0|[1-9]\d{0,2})$/.test(raw) || Number(raw) > 365) {
    throw new PlanningError('SCHEDULE_NOT_CONFIGURED', 'Die Freigabe-Frist ist noch nicht konfiguriert (BOOKING_RELEASE_LEAD_DAYS: 0–365).', 503);
  }
  return { leadDays: Number(raw), timeZone: TIME_ZONE, time: EXECUTION_TIME };
}

const berlin = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
function localParts(instant) {
  return Object.fromEntries(berlin.formatToParts(instant).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
export function scheduledExecutionAt(parkingDate, leadDays) {
  const { y, m, d } = isoToParts(parkingDate);
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) throw new PlanningError('INVALID_LEAD_DAYS', 'Die Freigabe-Frist muss 0–365 Kalendertage betragen.');
  // Calendar-day subtraction precedes timezone conversion. Never subtract 24h
  // from a UTC execution instant across a DST boundary.
  const wallTime = Date.UTC(y, m - 1, d - leadDays, 0, 1);
  let instant = wallTime;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(instant));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant += wallTime - represented;
  }
  const actual = localParts(new Date(instant));
  if (Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second) !== wallTime) {
    throw new PlanningError('INVALID_EXECUTION_TIME', 'Die lokale Ausführungszeit konnte nicht eindeutig berechnet werden.');
  }
  return new Date(instant).toISOString();
}

export function validateId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new PlanningError('INVALID_ID', 'Ungültige Buchungs-ID.');
  return id;
}
export function validateVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1 || version > 2147483646) throw new PlanningError('INVALID_VERSION', 'Ungültige Planversion.');
  return version;
}
export function validatePlan(body, rule, { now = new Date(), editing = false } = {}) {
  const fields = ['parkingDate', 'slot', 'stationPriorities', 'allowFallback', ...(editing ? ['version'] : [])];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k))) throw new PlanningError('INVALID_PLAN', 'Ungültige oder unbekannte Planfelder.');
  let valid;
  try { valid = validateInput({ date: body.parkingDate, slot: body.slot, priorities: body.stationPriorities, fallback: body.allowFallback }); }
  catch { throw new PlanningError('INVALID_PLAN', 'Parkdatum, Zeitslot, Prioritäten oder Fallback sind ungültig.'); }
  if (!valid.fallback && valid.priorities.length === 0) throw new PlanningError('NO_STATION_CHOICE', 'Ohne Fallback muss mindestens eine Säule angegeben werden.');
  const scheduled = scheduledExecutionAt(valid.date, rule.leadDays);
  if (new Date(scheduled) <= now) throw new PlanningError('EXECUTION_IN_PAST', 'Der berechnete Buchungszeitpunkt liegt bereits in der Vergangenheit.');
  return { parkingDate: valid.date, slot: valid.slot, stationPriorities: valid.priorities, allowFallback: valid.fallback,
    scheduledExecutionAt: scheduled, releaseLeadDays: rule.leadDays, timeZone: TIME_ZONE,
    ...(editing ? { version: validateVersion(body.version) } : {}) };
}
export function validateCancellation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'version')) throw new PlanningError('INVALID_CANCELLATION', 'Zur Stornierung wird die Planversion benötigt.');
  return validateVersion(body.version);
}
export function canTransition(from, to, { mode = 'live' } = {}) {
  const transitions = { planned: ['preparing', 'cancelled'], preparing: ['running', 'failed', 'unknown'], running: ['booked', 'failed', 'unknown'] };
  if (mode === 'dry_run' && to === 'booked') return false;
  if (mode === 'dry_run' && from === 'running' && to === 'planned') return true;
  return Boolean(transitions[from]?.includes(to));
}
export function assertTransition(from, to, options) {
  if (!canTransition(from, to, options)) throw new PlanningError('INVALID_TRANSITION', 'Dieser Statuswechsel ist nicht erlaubt.', 409);
}
