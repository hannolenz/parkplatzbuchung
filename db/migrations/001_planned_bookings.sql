CREATE TABLE planned_bookings (
  id uuid PRIMARY KEY,
  parking_date date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('morning', 'afternoon')),
  station_priorities text[] NOT NULL CHECK (cardinality(station_priorities) <= 100 AND array_position(station_priorities, NULL) IS NULL AND (cardinality(station_priorities) = 0 OR array_to_string(station_priorities, ',') ~ '^([1-9][0-9]{0,9})(,[1-9][0-9]{0,9})*$')),
  allow_fallback boolean NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'preparing', 'running', 'booked', 'failed', 'unknown', 'cancelled')),
  scheduled_execution_at timestamptz NOT NULL,
  release_lead_days integer NOT NULL CHECK (release_lead_days BETWEEN 0 AND 365),
  time_zone text NOT NULL CHECK (time_zone = 'Europe/Berlin'),
  selected_station text CHECK (selected_station ~ '^[1-9][0-9]{0,9}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text CHECK (length(last_error) <= 1000),
  result_message text CHECK (length(result_message) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  dry_run_completed_at timestamptz,
  CHECK (allow_fallback OR cardinality(station_priorities) > 0)
);
-- Single-user protection across separate plans, not only the same job ID.
CREATE UNIQUE INDEX one_active_plan_per_slot ON planned_bookings (parking_date, slot) WHERE status <> 'cancelled';
CREATE INDEX due_planned_bookings ON planned_bookings (scheduled_execution_at, id) WHERE status = 'planned';

CREATE TABLE booking_attempts (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES planned_bookings(id),
  plan_version integer NOT NULL CHECK (plan_version >= 1),
  mode text NOT NULL CHECK (mode IN ('dry_run', 'live')),
  status text NOT NULL CHECK (status IN ('preparing', 'running', 'simulated', 'booked', 'failed', 'unknown')),
  worker_id text NOT NULL CHECK (worker_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  input_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text CHECK (length(last_error) <= 1000),
  result_message text CHECK (length(result_message) <= 2000),
  UNIQUE (booking_id, plan_version, mode),
  CHECK (NOT (mode = 'dry_run' AND status = 'booked')),
  CHECK (status <> 'simulated' OR mode = 'dry_run')
);
CREATE UNIQUE INDEX one_active_attempt ON booking_attempts (booking_id) WHERE status IN ('preparing', 'running');
-- Future live execution: at most one attempt per job, even across plan edits.
-- No code in phase 2A can create or execute a live attempt.
CREATE UNIQUE INDEX one_live_attempt_per_booking ON booking_attempts (booking_id) WHERE mode = 'live';
