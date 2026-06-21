CREATE TABLE auth.audit_logs (
  log_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES auth.users(user_id) ON DELETE SET NULL,
  event      TEXT        NOT NULL,
  ip_address TEXT,
  user_agent TEXT,  -- stores browser or device information
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_not_empty CHECK (char_length(event) > 0) -- every log must describe actual event and not empty
);

CREATE INDEX idx_audit_logs_user_id   ON auth.audit_logs (user_id); -- activities of user
CREATE INDEX idx_audit_logs_event     ON auth.audit_logs (event); -- all failed login attempt
CREATE INDEX idx_audit_logs_created_at ON auth.audit_logs (created_at DESC); -- latest activity first
