# Redis

## Version

V1

---

## Overview

Redis is used across all services as an in-memory data store for time-sensitive, high-frequency operations. It reduces database load by handling lookups that would otherwise hit PostgreSQL on every request — token blacklisting, rate limiting, idempotency checks, and agent availability all run through Redis.

The platform uses **ioredis** as the Redis client.

---

## Why Redis

| Requirement             | How Redis Meets It                                          |
| ----------------------- | ----------------------------------------------------------- |
| Sub-millisecond lookups | In-memory — no disk I/O                                     |
| Automatic expiry        | Native TTL on every key — no cleanup jobs needed            |
| Atomic operations       | Lua scripts execute atomically — no race conditions         |
| High-frequency writes   | Handles rate limit counters and idempotency keys at scale   |
| Temporary state         | Data that should expire naturally — tokens, counters, flags |

---

## Usage Across Services

| Service         | What It Stores In Redis                                    |
| --------------- | ---------------------------------------------------------- |
| API Gateway     | Token blacklist, rate limit counters                       |
| Auth Service    | Blacklisted access tokens, password reset tokens           |
| Payment Service | Idempotency keys                                           |
| Support Service | Agent availability status, escalation flags, session state |

---

## Use Case 1 — Token Blacklist

When a user logs out, their access token is stored in Redis with a TTL matching the token's remaining lifespan. The API Gateway checks this blacklist on every request before forwarding to any service.

**Key pattern:**

```
blacklist:<token>  →  user_id  →  TTL = remaining token lifespan
```

**Flow:**

```
User logs out
      ↓
Access token stored in Redis blacklist
TTL = remaining lifespan of the token
      ↓
Refresh token cookie cleared
      ↓
Every subsequent request hits API Gateway
      ↓
Gateway checks Redis blacklist
Token found → reject 401 Unauthorized
Token not found → allow request
      ↓
Token TTL expires → Redis auto-deletes the key
```

**Why TTL matches remaining lifespan:**
Once the token would have expired anyway, there is no need to keep it in the blacklist. The key auto-deletes itself — no manual cleanup required.

---

## Use Case 2 — Password Reset Tokens

Password reset tokens are stored only in Redis — never in the database. They are single-use and expire after 15 minutes.

**Key pattern:**

```
password_reset:<token>  →  user_id  →  TTL = 15 minutes
```

**Flow:**

```
User submits email
      ↓
Server generates token via crypto.randomBytes
Token stored in Redis: password_reset:<token> → user_id, TTL = 15 min
Reset link sent to email
      ↓
User submits new password with token
      ↓
Server validates token against Redis
      ↓
Token valid:
  → Hash new password → update users table
  → Delete token from Redis immediately (single-use enforced)
  → Blacklist all active access tokens for this user
  → Clear all refresh token cookies
  → Return 200 OK

Token not found or expired:
  → Return 400 Bad Request
```

**Why Redis and not the database:**
The token is temporary — it has no value after use and must expire automatically. Storing it in PostgreSQL would require a cleanup job. Redis handles expiry natively.

---

## Use Case 3 — Idempotency Keys

Every payment request must include an `Idempotency-Key` header. The Payment Service checks Redis before processing — if the key exists, the previous result is returned without processing the payment again.

**Key pattern:**

```
idempotency:<key>  →  previous result  →  TTL = 24 hours
```

**Flow:**

```
Client sends POST /v1/payments/send with Idempotency-Key header
      ↓
Payment Service checks Redis for key
      ↓
Key exists    → return previous result, no duplicate charge
Key not found → process payment, store result in Redis
```

**Why this matters:**
A network timeout may cause the client to retry a request. Without idempotency, two payments could be processed for a single user action. The Redis check prevents this regardless of how many retries occur.

---

## Use Case 4 — Rate Limiting

The platform uses a shared rate limiter middleware backed by Redis. Each service configures its own rules — limits are enforced per user or per IP depending on the endpoint.

**Key pattern:**

```
rl:<keyPrefix>:<label>:<identifier>  →  request count  →  TTL = window seconds
```

**Example keys:**

```
rl:forgot-password:per-hour:ip:102.89.1.1
rl:login:per-15min:user:uuid
rl:payments-send:per-minute:user:uuid
```

**How it works — Lua script (atomic):**

Redis executes Lua scripts atomically. The increment and expiry are a single round trip — no race condition between the `INCR` and `EXPIRE` operations.

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
```

**Flow:**

```
Request arrives
      ↓
Redis increments counter for this user/IP
      ↓
Counter ≤ limit  → allow request
Counter > limit  → return 429 Too Many Requests
                   response includes TTL (retry-after seconds)
      ↓
Window expires → Redis auto-deletes key, counter resets
```

**Fail open:**
If Redis is unavailable, the rate limiter fails open — legitimate requests are never blocked by an infrastructure outage. This is a deliberate trade-off: availability over strict enforcement during Redis downtime.

**Per-service rules:**

| Service | Endpoint                        | Limit                  | Identified By |
| ------- | ------------------------------- | ---------------------- | ------------- |
| Auth    | `POST /v1/auth/login`           | 10 requests per 15 min | IP            |
| Auth    | `POST /v1/auth/forgot-password` | 5 requests per hour    | IP            |
| Payment | `POST /v1/payments/send`        | 20 requests per minute | User          |
| Support | `POST /v1/support/chat`         | 50 requests per minute | User          |

> When the API Gateway is built, all rate limiting rules will move there and the per-service middleware will be removed. The shared `rateLimiter` function will remain in the shared folder — only the wiring changes.

---

## Use Case 5 — Agent Availability

The Support Service tracks each agent's availability status in Redis for fast lookups during chat routing and escalation.

**Key pattern:**

```
agent:availability:<agent_id>  →  online | offline | busy
```

**Flow:**

```
Agent updates status → PATCH /v1/support/agents/availability
      ↓
Redis key updated immediately
      ↓
Customer escalates to live agent
      ↓
Chat Router checks Redis for available agent
      ↓
Agent found  → session assigned
No agent     → message queued in offline.queue
```

---

## Use Case 6 — Escalation Flags

When a customer requests a live agent or AI confidence drops below threshold, an escalation flag is set in Redis for that session. The Chat Router reads this flag to decide whether to route messages to AI or to a human agent.

**Key pattern:**

```
escalation:<session_id>  →  true  →  TTL = session lifespan
```

**Flow:**

```
Customer types "I want a human"
OR AI confidence drops below threshold
      ↓
Escalation flag set in Redis for session_id
      ↓
Session published to RabbitMQ agent.escalation queue
      ↓
Chat Router checks escalation flag on every message
Flag set → route to assigned agent
Flag not set → route to AI
```

---

## Key Summary

| Key Pattern                        | Value           | TTL                          | Set By            |
| ---------------------------------- | --------------- | ---------------------------- | ----------------- |
| `blacklist:<token>`                | `user_id`       | Remaining token lifespan     | Auth Service      |
| `password_reset:<token>`           | `user_id`       | 15 minutes                   | Auth Service      |
| `idempotency:<key>`                | Previous result | 24 hours                     | Payment Service   |
| `rl:<prefix>:<label>:<identifier>` | Request count   | Window duration              | Shared middleware |
| `agent:availability:<agent_id>`    | Status string   | No expiry — manually updated | Support Service   |
| `escalation:<session_id>`          | `true`          | Session lifespan             | Support Service   |
| `balance:<userId>`                 | account balance | 30 seconds                   | Payment Service   |

---

## Further Reading

| Topic                         | Location                                                  |
| ----------------------------- | --------------------------------------------------------- |
| RabbitMQ queues               | [rabbitmq.md](../infrastructure/rabbitmq.md)              |
| Auth Service — token flow     | [auth.md](../../../../services/auth-service/docs/auth.md) |
| Payment Service — idempotency | [payment.md](../../../payment-service/docs/payment.md)    |
| Support Service — chat flow   | [support.md](../../../support-service/docs/support.md)    |
