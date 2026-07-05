# API Gateway

## Version

V1

---

## Overview

The API Gateway is the single entry point into the platform. No client — mobile app, web app, or external merchant system — ever communicates directly with any service. Every request passes through the gateway first.

**Port:** `3000`
**Base URL:** `/v1`

The gateway has no database schema of its own. It reads from Redis only — token blacklist and rate limit counters.

---

## Responsibilities

- **JWT validation** — verifies every token before any request proceeds
- **RBAC enforcement** — checks the user's role against the requested endpoint
- **Rate limiting** — enforces request limits per user or IP via shared Redis middleware
- **Request routing** — forwards each request to the correct downstream service
- **Request logging** — records every incoming request in one central place

The gateway does not contain any business logic. It only validates, checks, routes, and logs.

---

## Why a Single Entry Point

Without a gateway, every service would need to implement its own JWT validation, RBAC, rate limiting, and logging. That means:

- Duplicated security logic across five services
- A bug in one service's auth check leaves that service unprotected
- No single place to audit all incoming traffic

The gateway centralises all of this. If a request passes the gateway, every downstream service can trust that the token is valid, the role is allowed, and the rate limit has not been exceeded.

---

## Dependencies

| Dependency        | Used For                                    |
| ----------------- | ------------------------------------------- |
| Redis             | Token blacklist checks, rate limit counters |
| Shared middleware | `rateLimiter`, `authenticate`, `validate`   |
| Pino              | Structured request logging                  |

---

## Request Lifecycle

Every request passes through these steps in order. If any step fails, the request is rejected and never reaches a service.

```
Request arrives at API Gateway
      ↓
1. JWT Validation
   Is the Authorization header present?
   Is the token signature valid?
   Is the token blacklisted in Redis?
   → Fail → 401 Unauthorized
      ↓
2. RBAC Check
   Is this role allowed to call this endpoint?
   → Fail → 403 Forbidden
      ↓
3. Rate Limit Check
   Has this user/IP exceeded their limit?
   → Fail → 429 Too Many Requests
      ↓
4. Request Logged
   Method, path, userId, role, requestId recorded
      ↓
5. Request Routed
   Forwarded to the correct downstream service
      ↓
6. Response returned to client
```

---

## JWT Validation

The gateway validates the JWT on every protected request before forwarding it anywhere.

**Validation steps:**

```
Authorization: Bearer <token> present?
      ↓ No → 401 No token provided
Verify token signature against JWT_SECRET
      ↓ Invalid → 401 Invalid token
      ↓ Expired → 401 Token has expired
Check Redis: GET blacklist:<token>
      ↓ Found → 401 Token has been invalidated
      ↓ Not found → attach userId, role, exp to request
Forward request to service
```

Public endpoints (register, login, forgot-password) bypass JWT validation — they are explicitly excluded from the authenticate middleware.

---

## RBAC Enforcement

Every protected endpoint declares which roles are allowed to access it. The gateway reads the role from the JWT payload and checks it before forwarding.

**Role definitions:**

| Role       | Access Level                                                              |
| ---------- | ------------------------------------------------------------------------- |
| `customer` | Own transactions, own complaints, chat, support                           |
| `agent`    | Assigned chats, complaint status updates, agent dashboard                 |
| `admin`    | All chats, all complaints, user management, analytics, webhook management |

**Enforcement:**

```
Role in JWT matches allowed roles for this endpoint?
      ↓ No  → 403 Forbidden (request never reaches service)
      ↓ Yes → forward request
```

Role mismatches are logged as a security warning with the `requestId`, `userId`, `role`, and the endpoint they attempted to access.

---

## Rate Limiting

Rate limiting is handled by the shared `rateLimiter` middleware imported from `shared/middleware/rateLimiter`. The function lives in shared — the gateway imports it and configures all rules in one place.

This means:

- All rate limit rules are centralised at the gateway — no per-service wiring
- Redis is the counter — accurate across all scaled service instances
- Per-service rate limiter wiring is removed once the gateway is built

**Global limits enforced at the gateway:**

| Scope                     | Limit                   |
| ------------------------- | ----------------------- |
| Per user (authenticated)  | 100 requests per minute |
| Per IP (public endpoints) | Defined per endpoint    |

**Public endpoint limits:**

| Endpoint                        | Limit                   | Identified By |
| ------------------------------- | ----------------------- | ------------- |
| `POST /v1/auth/register`        | 5 per min, 10 per hour  | IP            |
| `POST /v1/auth/login`           | 10 per min, 50 per hour | IP            |
| `POST /v1/auth/forgot-password` | 5 per hour              | IP            |

When a limit is exceeded the gateway returns `429 Too Many Requests` with a message indicating how many seconds until the window resets.

See `docs/infrastructure/redis.md` for the rate limiter implementation and Redis key structure.

---

## Request Routing

The gateway routes each request to the correct downstream service based on the URL prefix. Services are reached over the internal Docker / Kubernetes network by hostname.

Full routing rules are documented in `gateway/docs/routing.md`.

---

## Logging

Every request is logged at the gateway — this is the central audit point for all incoming traffic. Each log line includes:

| Field       | Value                                          |
| ----------- | ---------------------------------------------- |
| `requestId` | UUID generated at the gateway for this request |
| `method`    | HTTP method — GET, POST, PATCH, DELETE         |
| `path`      | Request path                                   |
| `userId`    | From JWT — null for public endpoints           |
| `role`      | From JWT — null for public endpoints           |
| `status`    | Response status code                           |
| `duration`  | Request duration in milliseconds               |

The `requestId` is attached to the request headers and passed through to every downstream service. This allows engineers to trace a single request end to end across all services and log lines.

**Security events logged at gateway level:**

| Event                        | Level  |
| ---------------------------- | ------ |
| JWT validation failed        | `warn` |
| Blacklisted token used       | `warn` |
| Role access denied (403)     | `warn` |
| Rate limit exceeded (429)    | `warn` |
| Request forwarded to service | `info` |

---

## Public vs Protected Endpoints

### Public — no JWT required

| Method | Endpoint                   | Routes To    |
| ------ | -------------------------- | ------------ |
| POST   | `/v1/auth/register`        | Auth Service |
| POST   | `/v1/auth/login`           | Auth Service |
| POST   | `/v1/auth/forgot-password` | Auth Service |
| POST   | `/v1/auth/reset-password`  | Auth Service |

### Protected — JWT + RBAC required

| Method | Endpoint                               | Role                   | Routes To       |
| ------ | -------------------------------------- | ---------------------- | --------------- |
| POST   | `/v1/auth/refresh`                     | Any authenticated      | Auth Service    |
| POST   | `/v1/auth/logout`                      | Any authenticated      | Auth Service    |
| POST   | `/v1/auth/logout/all`                  | Any authenticated      | Auth Service    |
| POST   | `/v1/payments/send`                    | Customer               | Payment Service |
| POST   | `/v1/payments/receive`                 | Customer               | Payment Service |
| GET    | `/v1/payments/:id`                     | Customer               | Payment Service |
| GET    | `/v1/payments/history`                 | Customer               | Payment Service |
| GET    | `/v1/accounts/balance`                 | Customer               | Payment Service |
| POST   | `/v1/support/chat/start`               | Customer               | Support Service |
| POST   | `/v1/support/chat/:sessionId/send`     | Customer, Agent        | Support Service |
| GET    | `/v1/support/chat/:sessionId/messages` | Customer, Agent        | Support Service |
| PATCH  | `/v1/support/chat/:sessionId/close`    | Agent, Admin           | Support Service |
| GET    | `/v1/support/chat/queue`               | Agent, Admin           | Support Service |
| PATCH  | `/v1/support/agents/availability`      | Agent                  | Support Service |
| POST   | `/v1/support/complaints`               | Customer               | Support Service |
| GET    | `/v1/support/complaints/:id`           | Customer, Agent, Admin | Support Service |
| GET    | `/v1/support/complaints/history`       | Customer               | Support Service |
| PATCH  | `/v1/support/complaints/:id/update`    | Agent, Admin           | Support Service |
| GET    | `/v1/support/complaints/all`           | Admin                  | Support Service |
| PATCH  | `/v1/support/complaints/:id/assign`    | Admin                  | Support Service |

---

## Environment Variables

| Variable                   | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `JWT_SECRET`               | Verifies access token signatures               |
| `REDIS_URL`                | Redis connection for blacklist and rate limits |
| `AUTH_SERVICE_URL`         | Internal URL for Auth Service                  |
| `PAYMENT_SERVICE_URL`      | Internal URL for Payment Service               |
| `SUPPORT_SERVICE_URL`      | Internal URL for Support Service               |
| `NOTIFICATION_SERVICE_URL` | Internal URL for Notification Service          |
| `LOG_LEVEL`                | Pino log level — `info` in production          |
| `PORT`                     | Gateway port — `3000`                          |

---

## Further Reading

| Topic                       | Location                                                  |
| --------------------------- | --------------------------------------------------------- |
| Routing rules in detail     | [routing.md](../gateway/routing.md)                       |
| Rate limiter implementation | [security.md](../docs/security.md)                        |
| RBAC and role definitions   | [security.md](../docs/security.md)                        |
| JWT validation detail       | [auth.md](../../../../services/auth-service/docs/auth.md) |
| Logging standards           | [logging.md](../logging.md)                               |
