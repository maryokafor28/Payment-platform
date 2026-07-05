CREATE TABLE auth.audit_logs (
  audit_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        REFERENCES auth.users(user_id) ON DELETE SET NULL,
  role           TEXT        NOT NULL,                          -- role at time of action
  event          TEXT        NOT NULL,                          -- e.g. payment.initiated
  entity         TEXT,                                          -- e.g. payments, complaints
  entity_id      UUID,                                          -- the affected record
  previous_value JSONB,                                         -- state before action
  new_value      JSONB,                                         -- state after action
  ip_address     TEXT,
  user_agent     TEXT,
  request_id     UUID,                                          -- links to Pino log
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_not_empty CHECK (char_length(event) > 0)
);

-- Indexes
CREATE INDEX idx_audit_logs_user_id    ON auth.audit_logs (user_id);
CREATE INDEX idx_audit_logs_event      ON auth.audit_logs (event);
CREATE INDEX idx_audit_logs_entity_id  ON auth.audit_logs (entity_id);   -- full history of a specific record
CREATE INDEX idx_audit_logs_created_at ON auth.audit_logs (created_at DESC);