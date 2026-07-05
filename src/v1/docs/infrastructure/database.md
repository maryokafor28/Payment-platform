# Database

## Version

V1

---

## Overview

The platform uses PostgreSQL as its primary database for all relational data. PostgreSQL was chosen because it has the strongest ACID compliance of any open-source SQL database, handles UUIDs natively, and supports row-level locking — which is critical for concurrent payment debits and credits.

---

## Schema Ownership

Each service owns its own PostgreSQL schema. Services never query another service's tables directly. If a service needs data from another service, it goes through an internal HTTP call or a RabbitMQ event — never a direct cross-schema query.

```
PostgreSQL (one instance)
├── auth          schema → users, refresh_tokens, audit_logs
├── payments      schema → accounts, transactions
├── support       schema → support_agents, chat_sessions, chat_messages, complaints
└── notifications schema → notification_logs
```

---

## Why PostgreSQL

| Requirement                   | How PostgreSQL Meets It                                       |
| ----------------------------- | ------------------------------------------------------------- |
| ACID transactions             | Strongest ACID compliance of any open-source SQL database     |
| Concurrent payment operations | Row-level locking prevents race conditions on balance updates |
| UUID support                  | Native UUID type — no extension needed                        |
| Financial precision           | `NUMERIC(20,8)` — exact decimal storage, no floating point    |
| Relational integrity          | Foreign keys enforced at the database level                   |

---

## Database Normalization

All tables follow third normal form (3NF). Every column in a table must describe that table's primary key and nothing else.

**Key decisions:**

- User names, emails, and roles live only in `users`. No other table duplicates them.
- Account balance lives in `accounts`, not `users`. A user is a person; an account is a financial entity.
- Assigned chats are not stored as a list on the agent record — they are derived by querying `chat_sessions WHERE agent_id = ?`.
- `sender_role` on `chat_messages` is a justified exception — historical accuracy requires capturing the role at the time the message was sent. If an agent's role later changes, the historical record must still reflect what role they held when the message was sent.

---

## UUIDs for Identifiers

All critical records use UUIDs as their primary key — user IDs, payment IDs, transaction IDs, chat session IDs, complaint ticket IDs.

**Why UUIDs over auto-increment integers:**

| Reason                       | Detail                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| Globally unique              | Safe across distributed services — no ID collision between schemas |
| No enumeration attacks       | Attackers cannot guess sequential IDs to scrape records            |
| Safe for distributed systems | Can be generated anywhere without a central counter                |

---

## ACID Transaction Guarantee

Every payment operation runs inside a single database transaction. If any step fails, the entire operation rolls back — no partial state is ever written.

```
BEGIN TRANSACTION
  1. Verify sender account balance
  2. Debit sender account
  3. Credit receiver account
  4. Record transaction
COMMIT
— if any step fails → full ROLLBACK
```

This guarantees that money is never debited without being credited, and a transaction record is never written without the balance update completing.

---

## Auth Schema Tables

### `users`

| Field         | Type        | Description                                                   |
| ------------- | ----------- | ------------------------------------------------------------- |
| user_id       | UUID PK     | Unique identifier                                             |
| email         | TEXT UNIQUE | Lowercase, max 150 chars, validated against email format      |
| password_hash | TEXT        | Hashed password — never stored as plaintext                   |
| role          | ENUM        | `customer` / `agent` / `admin` — defaults to `customer`       |
| created_at    | TIMESTAMPTZ | Account creation time                                         |
| updated_at    | TIMESTAMPTZ | Auto-updated via `trg_set_updated_at` trigger on every change |

**Constraints:**

- `email_format` — must match basic email pattern
- `email_length` — max 150 characters
- `email_lowercase` — must be lowercase, enforced at application level before insert
- `password_hash_not_empty` — cannot be an empty string

**Trigger:** `trg_set_updated_at` — fires `BEFORE UPDATE` only when the row actually changed (`OLD IS DISTINCT FROM NEW`). Defined in `002_create_trigger.sql` and reused across all tables that have `updated_at`.

### `refresh_tokens`

Stores active refresh tokens per user. Used to support logout from all devices — all tokens for a user can be invalidated in a single operation by setting `revoked = TRUE`.

| Field       | Type        | Description                                     |
| ----------- | ----------- | ----------------------------------------------- |
| token_id    | UUID PK     | Unique identifier                               |
| user_id     | UUID FK     | References `users.user_id` — cascades on delete |
| token_hash  | TEXT UNIQUE | Hashed refresh token — never stored raw         |
| expires_at  | TIMESTAMPTZ | When this token expires                         |
| revoked     | BOOLEAN     | `FALSE` by default — set to `TRUE` on logout    |
| device_info | TEXT        | Human readable device e.g. `iPhone Safari`      |
| user_agent  | TEXT        | Raw user agent string from request header       |
| ip_address  | TEXT        | IP address when the token was issued            |
| updated_at  | TIMESTAMPTZ | Auto-updated via trigger on every change        |
| created_at  | TIMESTAMPTZ | When this token was issued                      |

**Constraints:**

- `token_hash_not_empty` — cannot be an empty string
- `expires_after_created` — `expires_at` must be after `created_at`

**Indexes:**

- `idx_refresh_tokens_user_id` — find all tokens for a user (logout all devices)
- `idx_refresh_tokens_expires_at` — cleanup job to delete expired tokens
- `idx_refresh_tokens_user_active` — partial index `WHERE revoked = FALSE` — only scans active tokens, stays small and fast

### `audit_logs` — Auth Schema

Permanent, write-only record of every sensitive action. No UPDATE or DELETE is ever permitted on this table.

| Field          | Type        | Description                                              |
| -------------- | ----------- | -------------------------------------------------------- |
| audit_id       | UUID PK     | Unique record identifier                                 |
| user_id        | UUID FK     | Who performed the action — `SET NULL` on user delete     |
| role           | TEXT        | Their role at the time: `customer`, `agent`, `admin`     |
| event          | TEXT        | e.g. `payment.initiated`, `complaint.status.updated`     |
| entity         | TEXT        | The affected resource: `payments`, `complaints`, `users` |
| entity_id      | UUID        | The specific record that was affected                    |
| previous_value | JSONB       | State of the record before the action                    |
| new_value      | JSONB       | State of the record after the action                     |
| ip_address     | TEXT        | IP address the request came from                         |
| user_agent     | TEXT        | Browser or device information                            |
| request_id     | UUID        | Links to Pino application log for full trace             |
| created_at     | TIMESTAMPTZ | When the action occurred — immutable, never updated      |

**Constraints:**

- `event_not_empty` — event must describe an actual action, cannot be empty
- No `updated_at` column — audit logs are write-only, never updated

**Indexes:**

- `idx_audit_logs_user_id` — all activity by a specific user
- `idx_audit_logs_event` — query by event type e.g. all failed logins
- `idx_audit_logs_entity_id` — full history of a specific record
- `idx_audit_logs_created_at DESC` — latest activity first

**Migration files — auth schema:**

| File                            | Purpose                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `001_create_users.sql`          | `users` table, ENUM type, constraints                                                   |
| `002_create_trigger.sql`        | `auth.set_updated_at()` function + trigger — reused across all tables with `updated_at` |
| `003_create_refresh_tokens.sql` | `refresh_tokens` table, indexes                                                         |
| `004_create_audit_logs.sql`     | `audit_logs` table, indexes                                                             |

---

## Payments Schema Tables

### `accounts`

Separated from `users` because balance is a financial property, not a user property. A user is a person; an account is a financial entity.

| Field      | Type          | Description                     |
| ---------- | ------------- | ------------------------------- |
| account_id | UUID PK       | Unique identifier               |
| user_id    | UUID FK       | References `auth.users.user_id` |
| balance    | NUMERIC(20,8) | Current account balance         |
| currency   | TEXT          | Currency code e.g. `NGN`        |
| status     | ENUM          | `active` / `frozen` / `closed`  |
| created_at | TIMESTAMPTZ   | Account creation time           |
| updated_at | TIMESTAMPTZ   | Last balance update             |

### `transactions`

References `accounts`, not `users`, because money moves between accounts — not between people directly.

| Field               | Type          | Description                        |
| ------------------- | ------------- | ---------------------------------- |
| transaction_id      | UUID PK       | Unique identifier                  |
| idempotency_key     | TEXT UNIQUE   | Prevents duplicate processing      |
| sender_account_id   | UUID FK       | References `accounts.account_id`   |
| receiver_account_id | UUID FK       | References `accounts.account_id`   |
| amount              | NUMERIC(20,8) | Amount transferred                 |
| currency            | TEXT          | Currency code                      |
| status              | ENUM          | `pending` / `success` / `failed`   |
| created_at          | TIMESTAMPTZ   | When the transaction was initiated |

---

## Support Schema Tables

### `support_agents`

| Field               | Type        | Description                              |
| ------------------- | ----------- | ---------------------------------------- |
| agent_id            | UUID PK     | Unique identifier for this agent profile |
| user_id             | UUID FK     | References `auth.users.user_id`          |
| availability_status | ENUM        | `online` / `offline` / `busy`            |
| created_at          | TIMESTAMPTZ | When the agent account was created       |
| updated_at          | TIMESTAMPTZ | Last availability update                 |

### `chat_sessions`

`agent_id` is nullable — a session starts unassigned and is only populated when a customer escalates to a human agent.

| Field      | Type        | Description                                     |
| ---------- | ----------- | ----------------------------------------------- |
| session_id | UUID PK     | Unique identifier                               |
| user_id    | UUID FK     | References `auth.users.user_id`                 |
| agent_id   | UUID FK     | References `support_agents.agent_id` — nullable |
| status     | ENUM        | `active` / `closed`                             |
| created_at | TIMESTAMPTZ | When the session was opened                     |
| closed_at  | TIMESTAMPTZ | When the session was closed — nullable          |

### `chat_messages`

`sender_role` is stored intentionally for historical accuracy — if an agent's role later changes, the record must still reflect the role they held when the message was sent.

| Field       | Type        | Description                                                  |
| ----------- | ----------- | ------------------------------------------------------------ |
| message_id  | UUID PK     | Unique identifier                                            |
| session_id  | UUID FK     | References `chat_sessions.session_id`                        |
| sender_id   | UUID FK     | References `auth.users.user_id`                              |
| sender_role | ENUM        | `customer` / `agent` / `ai` — stored for historical accuracy |
| content     | TEXT        | Message body                                                 |
| status      | ENUM        | `pending` / `delivered`                                      |
| created_at  | TIMESTAMPTZ | When the message was sent                                    |

### `complaints`

`assigned_agent_id` is nullable — a complaint starts unassigned. Admin populates this via the assign endpoint.

| Field             | Type        | Description                                                                     |
| ----------------- | ----------- | ------------------------------------------------------------------------------- |
| complaint_id      | UUID PK     | Unique ticket identifier                                                        |
| user_id           | UUID FK     | References `auth.users.user_id`                                                 |
| transaction_id    | UUID FK     | References `payments.transactions.transaction_id`                               |
| assigned_agent_id | UUID FK     | References `support_agents.agent_id` — nullable until assigned                  |
| issue_type        | ENUM        | `failed_txn` / `wrong_amount` / `delayed` / `unauthorized` / `refund` / `other` |
| description       | TEXT        | Customer description of the issue                                               |
| status            | ENUM        | `open` / `in_review` / `resolved` / `closed`                                    |
| created_at        | TIMESTAMPTZ | When the complaint was lodged                                                   |
| updated_at        | TIMESTAMPTZ | Last status change                                                              |

---

## Notifications Schema Tables

### `notification_logs`

| Field           | Type        | Description                                   |
| --------------- | ----------- | --------------------------------------------- |
| notification_id | UUID PK     | Unique identifier                             |
| user_id         | UUID FK     | References `auth.users.user_id`               |
| event_type      | VARCHAR     | e.g. `payment.success`, `complaint.in_review` |
| payload         | JSONB       | Full event payload delivered to client        |
| delivered_at    | TIMESTAMPTZ | When the SSE was pushed                       |
| status          | ENUM        | `delivered` / `failed`                        |

---

## Further Reading

| Topic                  | Location                                                  |
| ---------------------- | --------------------------------------------------------- |
| Redis usage            | [redis.md](../infrastructure/redis.md)                    |
| RabbitMQ queues        | [rabbitmq.md](../infrastructure/rabbitmq.md)              |
| Auth Service detail    | [auth.md](../../../../services/auth-service/docs/auth.md) |
| Payment Service detail | [payment.md](../../../payment-service/docs/payment.md)    |
| Support Service detail | [support.md](../../../support-service/docs/support.md)    |
