# Auth Service

## Version

V1

---

## Overview

The Auth Service owns everything related to identity and access on the platform. It is the only service that creates users, issues tokens, and manages credentials. Every other service trusts the token the Auth Service issues — they never handle passwords or user creation themselves.

**Port:** `3001`
**Schema:** `auth`
**Base URL:** `/v1/auth`

---

## Responsibilities

- User registration — creates new accounts, always assigns `customer` role
- Login — validates credentials, issues JWT access token and refresh token
- Token refresh — rotates refresh token and issues new access token
- Logout — blacklists access token in Redis, revokes refresh token
- Logout all devices — blacklists access token, revokes all refresh tokens for user
- Password reset — time-limited single-use token flow via Redis
- Audit logging — writes every auth event to `auth.audit_logs`

---

## Dependencies

| Dependency   | Used For                                          |
| ------------ | ------------------------------------------------- |
| PostgreSQL   | `auth` schema — users, refresh_tokens, audit_logs |
| Redis        | Token blacklist, password reset tokens            |
| bcrypt       | Password hashing and comparison                   |
| jsonwebtoken | Signing and verifying access and refresh tokens   |
| zod          | Request body validation                           |
| pino         | Structured JSON logging                           |

---

## Database Tables

The Auth Service owns four tables and one trigger in the `auth` schema. It never reads or writes to any other service's schema.

| Table / Object       | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `users`              | User accounts, credentials, roles                        |
| `refresh_tokens`     | Active refresh tokens — supports rotation and revocation |
| `audit_logs`         | Permanent write-only record of every auth event          |
| `trg_set_updated_at` | Trigger — auto-updates `updated_at` on row change only   |

Full table definitions are in `docs/infrastructure/database.md`.

---

## Endpoints

### `POST /v1/auth/register`

Registers a new user account. Role is always set to `customer` — never accepted from the request body.

**Rate limit:** 5 per minute, 10 per hour — per IP

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass1"
}
```

**Validation rules:**

- `email` — trimmed, lowercased, max 150 characters, valid email format
- `password` — min 8 characters, max 128, must contain uppercase, lowercase, and a number

**Response `201`:**

```json
{
  "accessToken": "eyJ...",
  "userId": "uuid",
  "role": "customer"
}
```

**Refresh token** is set as an `HttpOnly` cookie on the response.

**Errors:**

| Status | Reason                                    |
| ------ | ----------------------------------------- |
| 409    | An account with this email already exists |
| 422    | Validation failed — details in message    |
| 500    | Failed to create user account             |

**What happens internally:**

```
Validate request body (zod)
      ↓
Check if email already exists in users table
      ↓
Hash password with bcrypt (12 salt rounds)
      ↓
Insert new user — role = customer
      ↓
Issue access token + refresh token (token pair)
Persist refresh token hash to refresh_tokens table
      ↓
Write audit log: user.registered
      ↓
Return access token in body
Set refresh token in HttpOnly cookie
```

---

### `POST /v1/auth/login`

Authenticates a user and returns a token pair.

**Rate limit:** 10 per minute, 50 per hour — per IP

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass1"
}
```

**Response `200`:**

```json
{
  "accessToken": "eyJ...",
  "userId": "uuid",
  "role": "customer"
}
```

**Refresh token** is set as an `HttpOnly` cookie on the response.

**Errors:**

| Status | Reason                    |
| ------ | ------------------------- |
| 401    | Invalid email or password |
| 422    | Validation failed         |

**Timing attack protection:**

Even when the email does not exist, `bcrypt.compare` still runs against a dummy hash. This keeps the response time constant — an attacker cannot enumerate registered emails by measuring how fast the server responds.

```typescript
const DUMMY_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const passwordMatches = await comparePassword(
  password,
  user?.password_hash ?? DUMMY_HASH,
);
```

**What happens internally:**

```
Validate request body (zod)
      ↓
Query users table by email
      ↓
Run bcrypt.compare regardless of whether user exists
      ↓
User not found OR password wrong:
  → Write audit log: auth.failed_login (with email)
  → Return 401 Invalid email or password
      ↓
Credentials valid:
  → Issue token pair
  → Write audit log: user.login
  → Return access token in body + refresh cookie
```

---

### `POST /v1/auth/refresh`

Generates a new access token using a valid refresh token. Rotates the refresh token on every use — the old token is immediately revoked and cannot be replayed.

**Rate limit:** 20 per minute — per user

**Refresh token** is read from the `HttpOnly` cookie automatically.

**Response `200`:**

```json
{
  "accessToken": "eyJ..."
}
```

**Errors:**

| Status | Reason                                 |
| ------ | -------------------------------------- |
| 401    | Invalid or expired refresh token       |
| 401    | Refresh token revoked or expired in DB |
| 401    | Account no longer exists               |

**Token rotation:**

Every successful refresh revokes the old token and issues a brand new pair. If a stolen refresh token is used after the legitimate user has already refreshed, it will be rejected because it was already revoked during rotation.

**What happens internally:**

```
Read refresh token from HttpOnly cookie
      ↓
Verify token signature (REFRESH_TOKEN_SECRET)
      ↓
Look up token hash in refresh_tokens table
      ↓
Token revoked or expired → 401
      ↓
Revoke old refresh token (rotation)
      ↓
Fetch user from users table
      ↓
Issue new token pair
      ↓
Write audit log: user.token_refreshed
      ↓
Return new access token in body + new refresh cookie
```

---

### `POST /v1/auth/logout`

Blacklists the current access token in Redis and revokes the refresh token cookie.

**Rate limit:** 10 per minute — per user

**Headers:** `Authorization: Bearer <accessToken>`

**Response `200`:**

```json
{
  "message": "Logged out successfully"
}
```

**What happens internally:**

```
Read access token from Authorization header
Read refresh token from HttpOnly cookie (optional)
      ↓
Calculate remaining lifespan of access token
      ↓
Store access token in Redis blacklist
  Key: blacklist:<token>
  Value: userId
  TTL: remaining token lifespan (auto-deletes when expired)
      ↓
If refresh token present → revoke in refresh_tokens table
      ↓
Clear refresh token cookie
      ↓
Write audit log: user.logout
```

---

### `POST /v1/auth/logout/all`

Logs the user out of every device. Blacklists the current access token and revokes all refresh tokens for this user.

**Rate limit:** 5 per minute — per user

**Headers:** `Authorization: Bearer <accessToken>`

**Response `200`:**

```json
{
  "message": "Logged out from all devices"
}
```

**What happens internally:**

```
Read access token from Authorization header
      ↓
Calculate remaining lifespan of access token
      ↓
Run in parallel:
  → Store access token in Redis blacklist (TTL = remaining lifespan)
  → SET revoked = TRUE on all refresh_tokens WHERE user_id = ? AND revoked = FALSE
    (hits the partial index — efficient even with many tokens)
      ↓
Write audit log: user.logout_all
```

---

### `POST /v1/auth/forgot-password`

Accepts an email address and sends a reset link if an account exists. Always returns the same response regardless of whether the email exists — prevents email enumeration.

**Rate limit:** 5 per hour — per IP

**Request body:**

```json
{
  "email": "user@example.com"
}
```

**Response `200`:**

```json
{
  "message": "If an account exists, a reset link has been sent"
}
```

**What happens internally:**

```
Validate request body (zod)
      ↓
Query users table by email
      ↓
Email not found → return 200 (same response — no enumeration)
      ↓
Email found:
  → Generate token: crypto.randomBytes(32).toString('hex')
  → Store in Redis: password_reset:<token> → userId, TTL = 900s (15 min)
  → Send reset link to email (TODO: via notification service)
  → Write audit log: user.password_reset_requested
      ↓
Return 200
```

> **Note:** Email delivery is currently logged only (`logger.info`). It will be wired to the Notification Service once that service is built.

---

### `POST /v1/auth/reset-password`

Accepts a reset token and new password. Validates the token against Redis, updates the password, and invalidates all existing sessions.

**Request body:**

```json
{
  "token": "hex-token-from-email",
  "newPassword": "NewSecurePass1"
}
```

**Response `200`:**

```json
{
  "message": "Password reset successfully"
}
```

**Errors:**

| Status | Reason                                |
| ------ | ------------------------------------- |
| 400    | Reset token is invalid or has expired |
| 422    | Validation failed                     |

**What happens internally:**

```
Validate request body (zod)
      ↓
Look up password_reset:<token> in Redis
      ↓
Token not found or expired → 400
      ↓
Token valid:
  Run in parallel:
    → Hash new password (bcrypt, 12 rounds)
    → Update users table: password_hash = new hash
    → Delete token from Redis immediately (single-use enforced)
    → Revoke all refresh tokens for this user
      ↓
Write audit log: user.password_reset_completed
      ↓
Return 200
```

---

## JWT

### Access Token

- Signed with `JWT_SECRET`
- Lifespan: configured via `JWT_EXPIRES_IN` (e.g. `15m`)
- Returned in the response body
- Client stores in memory — never in `localStorage` or `sessionStorage`
- Sent as `Authorization: Bearer <token>` on every protected request

### Refresh Token

- Signed with `REFRESH_TOKEN_SECRET`
- Lifespan: configured via `REFRESH_TOKEN_EXPIRES_IN` (e.g. `7d`)
- Stored as an `HttpOnly`, `Secure`, `SameSite` cookie
- Only used to call `POST /v1/auth/refresh`
- Hash stored in `refresh_tokens` table — raw token never persisted

### Token Payload

```json
{
  "userId": "uuid",
  "role": "customer | agent | admin",
  "iat": 1234567890,
  "exp": 1234567890
}
```

### Token Hashing

Refresh tokens are stored as SHA-256 hashes in the database — the raw token is never persisted. This means a database breach does not expose usable tokens.

```typescript
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

Lookup is done by hashing the incoming token and querying by hash — O(log n) via the unique index.

---

## Password Hashing

Passwords are hashed with `bcrypt` at a cost factor of 12 before being stored. The plaintext password never touches the database.

```typescript
const SALT_ROUNDS = 12;
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}
```

**Cost factor 12** means each hash takes ~300ms on modern hardware — slow enough to make brute force impractical, fast enough that legitimate logins are unaffected.

---

## Validation

All request bodies are validated with **Zod** before reaching the service layer. Invalid requests are rejected at the middleware level with `422 Unprocessable Entity` — the handler never runs.

**Password rules:**

- Min 8 characters, max 128
- Must contain at least one uppercase letter
- Must contain at least one lowercase letter
- Must contain at least one number

**Email rules:**

- Trimmed and lowercased before validation
- Max 150 characters
- Must match valid email format

---

## Middleware

### `authenticate`

Verifies the JWT access token on every protected request.

```
Authorization: Bearer <token> header present?
      ↓ No → 401 No token provided
      ↓ Yes
Verify token signature (JWT_SECRET)
      ↓ Invalid → 401 Invalid token
      ↓ Expired → 401 Token has expired
Check Redis blacklist: blacklist:<token>
      ↓ Found → 401 Token has been invalidated (logged as warn)
      ↓ Not found
Attach userId, role, exp to req.user
      ↓
next()
```

### `validate(schema)`

Validates request body against a Zod schema. Runs before the handler. Formats all validation errors into a single readable message.

```
schema.safeParse(req.body)
      ↓ Fails → 422 with field errors joined as string
      ↓ Passes
req.body = result.data (parsed and typed)
      ↓
next()
```

### Rate Limiters

Each endpoint has its own rate limiter configured with the shared Redis-backed middleware:

| Endpoint                | Limit                      | Identified By |
| ----------------------- | -------------------------- | ------------- |
| `POST /register`        | 5 per minute, 10 per hour  | IP            |
| `POST /login`           | 10 per minute, 50 per hour | IP            |
| `POST /forgot-password` | 5 per hour                 | IP            |
| `POST /refresh`         | 20 per minute              | User          |
| `POST /logout`          | 10 per minute              | User          |
| `POST /logout/all`      | 5 per minute               | User          |

---

## Audit Logging

Every auth event is written to `auth.audit_logs`. Audit logging never throws — failures are caught, logged via Pino, and swallowed so they never break the calling flow.

```typescript
export async function writeAuditLog(
  userId: string | null,
  event: string,
  metadata: Record<string, unknown> = {},
  meta: RequestMeta = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auth.audit_logs (user_id, event, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, event, meta.ip ?? null, meta.userAgent ?? null, metadata],
    );
  } catch (err) {
    logger.error({ err, event }, "Failed to write audit log");
  }
}
```

**Events logged:**

| Event                           | Trigger                                 |
| ------------------------------- | --------------------------------------- |
| `user.registered`               | Successful registration                 |
| `user.login`                    | Successful login                        |
| `auth.failed_login`             | Wrong password or email not found       |
| `user.token_refreshed`          | Successful token refresh                |
| `user.logout`                   | Single device logout                    |
| `user.logout_all`               | All devices logout                      |
| `user.password_reset_requested` | Forgot password submitted (email found) |
| `user.password_reset_completed` | Password successfully reset             |

`userId` can be `null` on `auth.failed_login` when the email does not exist in the database.

---

## Redis Usage

| Key Pattern               | Value  | TTL                      | Purpose                   |
| ------------------------- | ------ | ------------------------ | ------------------------- |
| `blacklist:<accessToken>` | userId | Remaining token lifespan | Logout token invalidation |
| `password_reset:<token>`  | userId | 900 seconds (15 minutes) | Single-use reset token    |

---

## Error Handling

All errors are passed to `next(new AppError(message, statusCode))`. The shared `AppError` class and global error handler format all error responses consistently. Async handlers are wrapped with `asyncHandler` so unhandled promise rejections are caught automatically.

---

## Environment Variables

| Variable                   | Purpose                               |
| -------------------------- | ------------------------------------- |
| `JWT_SECRET`               | Signs and verifies access tokens      |
| `JWT_EXPIRES_IN`           | Access token lifespan e.g. `15m`      |
| `REFRESH_TOKEN_SECRET`     | Signs and verifies refresh tokens     |
| `REFRESH_TOKEN_EXPIRES_IN` | Refresh token lifespan e.g. `7d`      |
| `DATABASE_URL`             | PostgreSQL connection string          |
| `REDIS_URL`                | Redis connection string               |
| `LOG_LEVEL`                | Pino log level — `info` in production |
| `NODE_ENV`                 | `development` enables pino-pretty     |

---

## Further Reading

| Topic                       | Location                               |
| --------------------------- | -------------------------------------- |
| Database table definitions  | `docs/infrastructure/database.md`      |
| Redis usage detail          | `docs/infrastructure/redis.md`         |
| Security overview           | `docs/security.md`                     |
| Rate limiter implementation | `docs/infrastructure/rate-limiting.md` |
| Sequence diagrams           | `auth/docs/sequence-diagrams.md`       |
