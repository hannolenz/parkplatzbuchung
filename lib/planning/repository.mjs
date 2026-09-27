import { randomUUID } from 'node:crypto';
import { PlanningError } from './domain.mjs';
export function bookingDTO(row) {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) result[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value instanceof Date ? value.toISOString() : value;
  return result;
}
const returning = 'b.*, b.parking_date::text AS parking_date';
export function createBookingRepository(database) {
  return {
    async list() {
      return (await database.query(`SELECT ${returning} FROM planned_bookings b ORDER BY b.parking_date DESC, b.created_at DESC LIMIT 200`)).rows.map(bookingDTO);
    },
    async create(plan) {
      const { rows } = await database.query(`INSERT INTO planned_bookings AS b
        (id, parking_date, slot, station_priorities, allow_fallback, scheduled_execution_at, release_lead_days, time_zone)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${returning}`,
      [randomUUID(), plan.parkingDate, plan.slot, plan.stationPriorities, plan.allowFallback, plan.scheduledExecutionAt, plan.releaseLeadDays, plan.timeZone]);
      return bookingDTO(rows[0]);
    },
    async update(id, plan) {
      const { rows } = await database.query(`UPDATE planned_bookings b SET parking_date=$2, slot=$3, station_priorities=$4, allow_fallback=$5,
        scheduled_execution_at=$6, release_lead_days=$7, time_zone=$8, version=version+1, updated_at=clock_timestamp(),
        dry_run_completed_at=NULL, started_at=NULL, finished_at=NULL, selected_station=NULL, last_error=NULL, result_message=NULL
        WHERE id=$1 AND version=$9 AND status='planned' AND scheduled_execution_at > clock_timestamp()
        RETURNING ${returning}`, [id, plan.parkingDate, plan.slot, plan.stationPriorities, plan.allowFallback, plan.scheduledExecutionAt, plan.releaseLeadDays, plan.timeZone, plan.version]);
      if (!rows[0]) throw new PlanningError('EDIT_CONFLICT', 'Der Plan wurde geändert, ist bereits fällig oder wird schon ausgeführt. Bitte neu laden.', 409);
      return bookingDTO(rows[0]);
    },
    async cancel(id, version) {
      const { rows } = await database.query(`UPDATE planned_bookings b SET status='cancelled', version=version+1,
        updated_at=clock_timestamp(), finished_at=clock_timestamp(), result_message='Plan vom Benutzer storniert.'
        WHERE id=$1 AND version=$2 AND status='planned' RETURNING ${returning}`, [id, version]);
      if (!rows[0]) throw new PlanningError('CANCEL_CONFLICT', 'Dieser Plan ist nicht mehr unverändert und stornierbar. Bitte neu laden.', 409);
      return bookingDTO(rows[0]);
    }
  };
}
