CREATE TYPE auth.user_role AS ENUM ('customer', 'agent', 'admin');

CREATE TABLE auth.users (
  user_id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT          NOT NULL UNIQUE,
  password_hash TEXT          NOT NULL,
  role          auth.user_role NOT NULL DEFAULT 'customer',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- constraints
  CONSTRAINT email_format CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  CONSTRAINT email_length CHECK (char_length(email) <= 150),
  CONSTRAINT email_lowercase CHECK (email = LOWER(email)),
  CONSTRAINT password_hash_not_empty CHECK (char_length(password_hash) > 0)
);

