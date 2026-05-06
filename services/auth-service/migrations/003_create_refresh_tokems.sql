CREATE TABLE auth.refresh_tokens (
  token_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- constraints
  CONSTRAINT token_hash_not_empty  CHECK (char_length(token_hash) > 0),
  CONSTRAINT expires_after_created CHECK (expires_at > created_at)
);

-- indexes
CREATE INDEX idx_refresh_tokens_user_id   ON auth.refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON auth.refresh_tokens (expires_at);
CREATE INDEX idx_refresh_tokens_user_active 
ON auth.refresh_tokens (user_id) 
WHERE revoked = FALSE;