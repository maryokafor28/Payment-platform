CREATE TABLE auth.audit_logs (
  log_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES auth.users(user_id) ON DELETE SET NULL,
  event      TEXT        NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT event_not_empty CHECK (char_length(event) > 0)
);

CREATE INDEX idx_audit_logs_user_id   ON auth.audit_logs (user_id);
CREATE INDEX idx_audit_logs_event     ON auth.audit_logs (event);
CREATE INDEX idx_audit_logs_created_at ON auth.audit_logs (created_at DESC);
