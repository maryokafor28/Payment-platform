# Security

## Version

V1

---

## Overview

Security is enforced at every layer of the platform — from the transport layer down to individual database operations. This document covers the platform-wide security design. Implementation details specific to each service are covered in their respective docs.

---

## Transport Security — HTTPS

All communication between client and server uses HTTPS. This encrypts every request and response in transit, prevents man-in-the-middle attacks, and protects authentication tokens from being intercepted.

**Rule:** No service accepts plain HTTP in production. All traffic is terminated at the Load Balancer over HTTPS.

---

## Authentication — JWT

The platform uses JSON Web Tokens (JWT) for authentication. Every protected request must carry a valid access token. The API Gateway validates the token before forwarding the request to any service.

### Two Token Types

| Token         | Storage            | Lifespan  | Purpose                                      |
|---------------|--------------------|-----------|----------------------------------------------|
| Access Token  | Response body      | 15 minutes | Used for authenticated requests              |
| Refresh Token | HttpOnly cookie    | 7 days     | Used to generate new access tokens           |

### Access Token

- Returned in the response body on login
- Client stores it in memory — never in `localStorage` or `sessionStorage`
- Sent in the `Authorization: Bearer <token>` header on every request
- Short lifespan (15 minutes) limits exposure if intercepted

### Refresh Token

- Stored in an `HttpOnly` cookie — JavaScript cannot access it
- Used only to call `POST /v1/auth/refresh` to get a new access token
- Cookie must have three flags set:

| Flag       | Purpose                                         |
|------------|-------------------------------------------------|
| `HttpOnly` | Prevents JavaScript from reading the cookie     |
| `Secure`   | Cookie only sent over HTTPS                     |
| `SameSite` | Prevents cross-site request forgery (CSRF)      |

### JWT Payload

```json
{
  "userId": "uuid",
  "role": "customer | agent | admin",
  "exp": 1234567890
}
```

The role is baked into the token at login. The API Gateway reads it directly without querying the database on every request.

---

## Token Blacklisting

When a user logs out, their access token is immediately blacklisted in Redis. The API Gateway checks this blacklist on every request.

```
User logs out
      ↓
Access token stored in Redis blacklist
TTL = remaining token lifespan
      ↓
Refresh token cookie cleared
      ↓
Every subsequent request → Gateway checks Redis blacklist
Token found     → reject 401 Unauthorized
Token not found → allow request
      ↓
Token expires → Redis auto-deletes the key
```

**Why TTL matches remaining lifespan:** Once the token would have expired anyway, keeping it in the blacklist wastes memory. The key self-deletes — no manual cleanup needed.

---

## Password Security

Passwords are never stored in plaintext. They are hashed before being written to the database.

- **Hashing:** `bcrypt` with a sufficient work factor
- **Validation:** Password hash is verified against the stored hash on login — the plaintext password never touches the database
- **Reset:** Password reset uses a time-limited, single-use token stored only in Redis — never in the database

### Password Reset Flow

```
User submits email
      ↓
Server always returns the same response
(prevents email enumeration — attacker cannot tell if email exists)
      ↓
If email exists:
  → Generate token via crypto.randomBytes
  → Store in Redis: password_reset:<token> → user_id, TTL = 15 min
  → Send reset link to email
      ↓
User submits new password with token
      ↓
Server validates token against Redis
      ↓
Valid:
  → Hash new password → update users table
  → Delete token from Redis immediately (single-use enforced)
  → Blacklist all active access tokens for this user
  → Clear all refresh token cookies
  → Return 200 OK

Invalid or expired:
  → Return 400 Bad Request
```

---

## Role-Based Access Control (RBAC)

Every endpoint is protected by role. The API Gateway checks the role claim in the JWT before forwarding any request to a service.

### Roles

| Role          | What They Can Do                                                                 |
|---------------|----------------------------------------------------------------------------------|
| Customer      | Start chats, send messages, lodge complaints, view own transactions and complaints|
| Support Agent | View assigned chats, respond to customers, update complaint status               |
| Admin         | View all chats and complaints, assign agents, manage accounts, access dashboards |

### How Roles Are Assigned

- Registration always assigns `customer` — users can never self-assign a role
- `agent` and `admin` roles are assigned manually in the database
- Role is stored in the `users` table and baked into the JWT at login

### Enforcement

Role enforcement happens at two levels:

```
Request arrives
      ↓
API Gateway checks JWT role claim against endpoint
Wrong role → 403 Forbidden (request never reaches the service)
      ↓
Service receives request
Service verifies role again internally
Wrong role → 403 Forbidden
```

Enforcing at both levels means a compromised gateway or a direct internal call cannot bypass role checks.

### Login Routing

There is a single login page — no role selection is shown to the user. After login the JWT role is read by the frontend and the user is redirected silently:

```
customer → /dashboard
agent    → /agent
admin    → /admin
```

---

## Rate Limiting

Rate limiting is enforced via shared Redis-backed middleware applied per service. It protects against brute force attacks, credential stuffing, and inbox flooding.

| Endpoint                        | Limit                   | Identified By |
|---------------------------------|-------------------------|---------------|
| `POST /v1/auth/login`           | 10 requests per 15 min  | IP            |
| `POST /v1/auth/forgot-password` | 5 requests per hour     | IP            |
| `POST /v1/payments/send`        | 20 requests per minute  | User          |
| `POST /v1/support/chat`         | 50 requests per minute  | User          |

When the limit is exceeded the server returns `429 Too Many Requests` with a `Retry-After` value in seconds.

**Fail open:** If Redis is unavailable the rate limiter fails open — legitimate requests are never blocked by an infrastructure outage.

> Rate limiting rules will move to the API Gateway once it is built. The shared middleware implementation remains unchanged — only the wiring changes.

---

## Security Events — Audit Logging

Every sensitive security event is written to the audit log permanently. Audit logs are write-only — no updates or deletes are ever permitted.

**Events logged:**

| Category        | Events                                                              |
|-----------------|---------------------------------------------------------------------|
| Authentication  | Login, logout, failed login, password changed, token refreshed      |
| Payments        | Payment initiated, approved, failed, refunded, duplicate blocked    |
| Admin actions   | Complaint assigned, agent assigned, role changed, webhook registered|
| Security        | Rate limit exceeded, multiple failed logins, 403 access attempt, fraud flag triggered |

See `infrastructure/database.md` for the full audit log table structure.

---

## Internal Network Security

- No service other than the API Gateway is reachable from the public internet
- All inter-service communication happens over the internal Docker / Kubernetes network
- Services communicate by hostname — no hardcoded IPs
- Credentials are injected via environment variables — never hardcoded in code or images

---

## Further Reading

| Topic                        | Location                                                        |
|------------------------------|-----------------------------------------------------------------|
| JWT implementation           | [auth.md](../../../../services/auth-service/docs/auth.md)                 |
| RBAC enforcement at gateway  | [overview.md](../gateway/overview.md)                           |
| Rate limiter implementation  | [security.md](../docs/security.md)                           |
| Audit log table structure    | [database.md](../infrastructure/database.md)                    |
| Redis token blacklist        | [redis.md](../infrastructure/redis.md)                          |