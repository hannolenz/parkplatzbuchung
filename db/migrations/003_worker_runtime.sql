-- Additive migration: retain all production plans and historical attempts.
ALTER TABLE planned_bookings ADD COLUMN dry_run_only boolean NOT NULL DEFAULT false;
ALTER TABLE planned_bookings ADD COLUMN dry_run_original_execution_at timestamptz;
ALTER TABLE booking_attempts ADD COLUMN execution_phase text NOT NULL DEFAULT 'legacy_unknown'
  CHECK (execution_phase IN ('legacy_unknown','before_critical','critical','completed'));
ALTER TABLE booking_attempts ADD COLUMN lease_until timestamptz;
ALTER TABLE booking_attempts ADD COLUMN heartbeat_at timestamptz;
ALTER TABLE booking_attempts ADD COLUMN worker_instance_id uuid;
ALTER TABLE booking_attempts ADD COLUMN retry_eligible boolean NOT NULL DEFAULT false;
CREATE INDEX expired_worker_claims ON booking_attempts(lease_until) WHERE status IN ('preparing','running');
CREATE TABLE worker_instances (
  worker_id text PRIMARY KEY CHECK (worker_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  instance_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('dry-run','live')),
  version text NOT NULL CHECK (length(version) <= 64),
  state text NOT NULL CHECK (state IN ('idle','working','degraded','stopping','stopped')),
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_successful_job uuid,
  last_error text CHECK (last_error IN ('WORKER_CYCLE_FAILED','HEARTBEAT_FAILED','ORPHAN_RECOVERED'))
);
-- Test overrides must never become future live orders, even through direct SQL.
CREATE FUNCTION protect_dry_run_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.dry_run_only AND NOT NEW.dry_run_only THEN
    RAISE EXCEPTION 'DRY_RUN_ONLY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.dry_run_only AND NEW.status='booked' THEN
    RAISE EXCEPTION 'DRY_RUN_CANNOT_BOOK' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_dry_run_plan BEFORE UPDATE ON planned_bookings FOR EACH ROW EXECUTE FUNCTION protect_dry_run_plan();
CREATE FUNCTION protect_dry_run_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode='live' AND EXISTS (SELECT 1 FROM planned_bookings WHERE id=NEW.booking_id AND dry_run_only) THEN
    RAISE EXCEPTION 'DRY_RUN_PLAN_CANNOT_RUN_LIVE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_dry_run_attempt BEFORE INSERT OR UPDATE ON booking_attempts FOR EACH ROW EXECUTE FUNCTION protect_dry_run_attempt();
