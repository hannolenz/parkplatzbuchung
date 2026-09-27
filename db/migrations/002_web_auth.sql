CREATE TABLE app_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  credential_version text NOT NULL CHECK (length(credential_version) = 64),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_sessions_expiry ON app_sessions(expires_at);
-- One fixed bucket: no spoofable client-IP headers, shared by every instance.
CREATE TABLE app_login_limits (
  bucket text PRIMARY KEY CHECK (bucket = 'single-user'),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
