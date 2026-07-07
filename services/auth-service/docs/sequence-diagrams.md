# Auth Service — Sequence Diagrams

## Version

V1

---

## 1. Register

Validates the request, rate-limits by IP, checks for an existing email, hashes
the password with bcrypt, creates the user and refresh token via Prisma, then
publishes a `user.registered` event to RabbitMQ for async audit logging.

## ![Register sequence diagram](<./diagrams/auth-register-sequence-final%20(1).drawio.svg>)

## 2. Login — Success

```
Client                    Auth Service              PostgreSQL            Redis
  |                            |                        |                   |
  |-- POST /v1/auth/login ----->|                        |                   |
  |   { email, password }      |                        |                   |
  |                            |-- validate (zod) ------>|                   |
  |                            |                        |                   |
  |                            |-- SELECT user --------->|                   |
  |                            |   WHERE email = $1     |                   |
  |                            |<-- user row -----------|                   |
  |                            |                        |                   |
  |                            |-- bcrypt.compare() --->|                   |
  |                            |   password vs hash     |                   |
  |                            |<-- true ---------------|                   |
  |                            |                        |                   |
  |                            |-- issueTokenPair() --->|                   |
  |                            |-- INSERT refresh_token >|                  |
  |                            |                        |                   |
  |                            |-- writeAuditLog() ----->|                   |
  |                            |   user.login           |                   |
  |                            |                        |                   |
  |<-- 200 accessToken --------|                        |                   |
  |    Set-Cookie refreshToken |                        |                   |
```

---

## 3. Login — Failed (timing attack protection)

```
Client                    Auth Service              PostgreSQL            Redis
  |                            |                        |                   |
  |-- POST /v1/auth/login ----->|                        |                   |
  |   { email, password }      |                        |                   |
  |                            |-- SELECT user --------->|                   |
  |                            |   WHERE email = $1     |                   |
  |                            |<-- rows: [] -----------|                   |
  |                            |                        |                   |
  |                            |-- bcrypt.compare() --->|                   |
  |                            |   password vs DUMMY_HASH (full cost runs)  |
  |                            |<-- false --------------|                   |
  |                            |                        |                   |
  |                            |-- writeAuditLog() ----->|                   |
  |                            |   auth.failed_login    |                   |
  |                            |   userId = null        |                   |
  |                            |                        |                   |
  |<-- 401 Invalid email ------|                        |                   |
  |    or password             |                        |                   |
  |                            |                        |                   |
  | (response time identical to success — no timing leak)                   |
```

---

## 4. Token Refresh — Rotation

```
Client                    Auth Service              PostgreSQL            Redis
  |                            |                        |                   |
  |-- POST /v1/auth/refresh --->|                        |                   |
  |   Cookie: refreshToken     |                        |                   |
  |                            |-- verifyRefreshToken() |                   |
  |                            |   check signature      |                   |
  |                            |<-- decoded payload ----|                   |
  |                            |                        |                   |
  |                            |-- findRefreshToken() -->|                  |
  |                            |   SELECT WHERE hash=$1 |                   |
  |                            |<-- { revoked, expires_at }                 |
  |                            |                        |                   |
  |                            |-- revoked OR expired? ->|                  |
  |                            |<-- 401 if true --------|                   |
  |                            |                        |                   |
  |                            |-- revokeRefreshToken() >|                  |
  |                            |   SET revoked = TRUE   |                   |
  |                            |                        |                   |
  |                            |-- SELECT user ---------->|                  |
  |                            |   WHERE user_id = $1   |                   |
  |                            |<-- user row -----------|                   |
  |                            |                        |                   |
  |                            |-- issueTokenPair() --->|                   |
  |                            |-- INSERT new refresh_token                 |
  |                            |                        |                   |
  |                            |-- writeAuditLog() ----->|                   |
  |                            |   user.token_refreshed |                   |
  |                            |                        |                   |
  |<-- 200 new accessToken ----|                        |                   |
  |    Set-Cookie new refreshToken                      |                   |
```

---

## 5. Logout — Single Device

```
Client                    Auth Service              PostgreSQL            Redis
  |                            |                        |                   |
  |-- POST /v1/auth/logout ---->|                        |                   |
  |   Authorization: Bearer    |                        |                   |
  |   Cookie: refreshToken     |                        |                   |
  |                            |-- authenticate() ----->|                   |
  |                            |   verify JWT           |                   |
  |                            |                        |                   |
  |                            |-- calculate TTL ------->|                   |
  |                            |   exp - now            |                   |
  |                            |                        |                   |
  |                            |-- Promise.all() ------->|                   |
  |                            |   SET blacklist:<token> |-- SET blacklist ->|
  |                            |   EX = remainingSeconds|                   |
  |                            |   revokeRefreshToken() >|                  |
  |                            |   SET revoked = TRUE   |                   |
  |                            |                        |                   |
  |                            |-- writeAuditLog() ----->|                   |
  |                            |   user.logout          |                   |
  |                            |                        |                   |
  |<-- 200 Logged out ---------|                        |                   |
  |    Clear-Cookie refreshToken                        |                   |
```

---

## 6. Logout — All Devices

```
Client                    Auth Service              PostgreSQL            Redis
  |                            |                        |                   |
  |-- POST /v1/auth/logout/all >|                        |                   |
  |   Authorization: Bearer    |                        |                   |
  |                            |-- authenticate() ----->|                   |
  |                            |                        |                   |
  |                            |-- Promise.all() ------->|                   |
  |                            |   SET blacklist:<token> |-- SET blacklist ->|
  |                            |   EX = remainingSeconds|                   |
  |                            |   UPDATE refresh_tokens>|                  |
  |                            |   SET revoked = TRUE   |                   |
  |                            |   WHERE user_id = $1   |                   |
  |                            |   AND revoked = FALSE  |                   |
  |                            |   (hits partial index) |                   |
  |                            |                        |                   |
  |                            |-- writeAuditLog() ----->|                   |
  |                            |   user.logout_all      |                   |
  |                            |                        |                   |
  |<-- 200 Logged out ---------|                        |                   |
  |    from all devices        |                        |                   |
```

---

## 7. Forgot Password

```
Client                    Auth Service              PostgreSQL            Redis
  |                            |                        |                   |
  |-- POST /v1/auth/---------->|                        |                   |
  |   forgot-password          |                        |                   |
  |   { email }                |                        |                   |
  |                            |-- validate (zod) ------>|                   |
  |                            |                        |                   |
  |                            |-- SELECT user_id ------>|                   |
  |                            |   WHERE email = $1     |                   |
  |                            |                        |                   |
  |           (if not found) --|-- return immediately -->|                   |
  |<-- 200 same response ------|   (no enumeration)     |                   |
  |                            |                        |                   |
  |           (if found) ------>|                        |                   |
  |                            |-- randomBytes(32) ---->|                   |
  |                            |-- SET password_reset:<token>           --->|
  |                            |   value = userId       |                   |
  |                            |   TTL = 900s (15 min)  |                   |
  |                            |                        |                   |
  |                            |-- writeAuditLog() ----->|                   |
  |                            |   user.password_reset_requested            |
  |                            |                        |                   |
  |                            |-- logger.info() ------->|                   |
  |                            |   (TODO: email delivery)|                  |
  |                            |                        |                   |
  |<-- 200 same response ------|                        |                   |
  |   "If an account exists,   |                        |                   |
  |    a reset link was sent"  |                        |                   |
```

---

## 8. Reset Password

```
Client                    Auth Service              PostgreSQL            Redis
  |                            |                        |                   |
  |-- POST /v1/auth/---------->|                        |                   |
  |   reset-password           |                        |                   |
  |   { token, newPassword }   |                        |                   |
  |                            |-- validate (zod) ------>|                   |
  |                            |                        |                   |
  |                            |-- GET password_reset:<token>           --->|
  |                            |<-- userId or null -----|------------------ |
  |                            |                        |                   |
  |                (not found) |-- throw 400 ---------->|                   |
  |<-- 400 token invalid ------|                        |                   |
  |    or expired              |                        |                   |
  |                            |                        |                   |
  |                (found) --->|                        |                   |
  |                            |-- hashPassword() ----->|                   |
  |                            |   bcrypt, 12 rounds    |                   |
  |                            |                        |                   |
  |                            |-- Promise.all() ------->|                   |
  |                            |   UPDATE users -------->|                  |
  |                            |   SET password_hash=$1 |                   |
  |                            |   DEL password_reset:<token>           --->|
  |                            |   (single-use enforced)|                   |
  |                            |   UPDATE refresh_tokens>|                  |
  |                            |   SET revoked = TRUE   |                   |
  |                            |   (all devices)        |                   |
  |                            |                        |                   |
  |                            |-- writeAuditLog() ----->|                   |
  |                            |   user.password_reset_completed            |
  |                            |                        |                   |
  |<-- 200 Password reset -----|                        |                   |
  |    successfully            |                        |                   |
```

---

## 9. Authenticated Request — Token Blacklist Check

```
Client               API Gateway              Redis           Auth Service
  |                       |                     |                  |
  |-- ANY protected ------>|                     |                  |
  |   request              |                     |                  |
  |   Authorization: Bearer|                     |                  |
  |                        |-- verifyJWT() ------>|                  |
  |                        |   check signature   |                  |
  |                        |                     |                  |
  |          (invalid) ----|-- 401 Invalid token >|                  |
  |<-- 401 ---------------|                     |                  |
  |                        |                     |                  |
  |          (valid) ------>|                     |                  |
  |                        |-- GET blacklist:<token>                |
  |                        |                     |                  |
  |          (found) ------>|                     |                  |
  |                        |-- logger.warn() ---->|                  |
  |<-- 401 invalidated ----|                     |                  |
  |                        |                     |                  |
  |          (not found) -->|                     |                  |
  |                        |-- forward request -->|-- to service    |
```
