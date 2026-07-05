# API Gateway — Routing

## Version

V1

---

## Overview

The gateway routes each incoming request to the correct downstream service based on the URL prefix. All services run on an internal private network and are never directly reachable from outside. Only the gateway has a public-facing address.

---

## How Routing Works

The gateway inspects the request path and forwards it to the matching service. The path prefix determines the destination — the rest of the path is passed through unchanged.

```
Incoming request path         → Routed to
/v1/auth/...                  → Auth Service        :3001
/v1/payments/...              → Payment Service     :3002
/v1/accounts/...              → Payment Service     :3002
/v1/support/...               → Support Service     :3004
/v1/notifications/...         → Notification Service :3003
```

---

## Internal Network

Services are reached by hostname over the internal Docker / Kubernetes network. No hardcoded IPs — hostnames resolve automatically via Docker networking in development and Kubernetes DNS in production.

```
API Gateway :3000
      ↓ internal network
  ├── auth-service:3001
  ├── payment-service:3002
  ├── notification-service:3003
  └── support-service:3004
```

---

## Route Table

### Auth Routes → Auth Service `:3001`

| Method | Path                       | Auth Required | Role |
| ------ | -------------------------- | ------------- | ---- |
| POST   | `/v1/auth/register`        | No            | —    |
| POST   | `/v1/auth/login`           | No            | —    |
| POST   | `/v1/auth/forgot-password` | No            | —    |
| POST   | `/v1/auth/reset-password`  | No            | —    |
| POST   | `/v1/auth/refresh`         | Yes           | Any  |
| POST   | `/v1/auth/logout`          | Yes           | Any  |
| POST   | `/v1/auth/logout/all`      | Yes           | Any  |

---

### Payment Routes → Payment Service `:3002`

| Method | Path                   | Auth Required | Role     |
| ------ | ---------------------- | ------------- | -------- |
| POST   | `/v1/payments/send`    | Yes           | Customer |
| POST   | `/v1/payments/receive` | Yes           | Customer |
| GET    | `/v1/payments/:id`     | Yes           | Customer |
| GET    | `/v1/payments/history` | Yes           | Customer |
| GET    | `/v1/accounts/balance` | Yes           | Customer |

---

### Support Routes → Support Service `:3004`

#### Chat

| Method | Path                                   | Auth Required | Role            |
| ------ | -------------------------------------- | ------------- | --------------- |
| POST   | `/v1/support/chat/start`               | Yes           | Customer        |
| GET    | `/v1/support/chat/:sessionId/messages` | Yes           | Customer, Agent |
| POST   | `/v1/support/chat/:sessionId/send`     | Yes           | Customer, Agent |
| PATCH  | `/v1/support/chat/:sessionId/close`    | Yes           | Agent, Admin    |
| GET    | `/v1/support/chat/queue`               | Yes           | Agent, Admin    |
| PATCH  | `/v1/support/agents/availability`      | Yes           | Agent           |

#### Complaints

| Method | Path                                | Auth Required | Role                   |
| ------ | ----------------------------------- | ------------- | ---------------------- |
| POST   | `/v1/support/complaints`            | Yes           | Customer               |
| GET    | `/v1/support/complaints/:id`        | Yes           | Customer, Agent, Admin |
| GET    | `/v1/support/complaints/history`    | Yes           | Customer               |
| PATCH  | `/v1/support/complaints/:id/update` | Yes           | Agent, Admin           |
| GET    | `/v1/support/complaints/all`        | Yes           | Admin                  |
| PATCH  | `/v1/support/complaints/:id/assign` | Yes           | Admin                  |

---

### Notification Routes → Notification Service `:3003`

| Method | Path                    | Auth Required | Role |
| ------ | ----------------------- | ------------- | ---- |
| GET    | `/v1/notifications/sse` | Yes           | Any  |

---

## Request Forwarding

When the gateway forwards a request to a service it passes through:

- The original request method, path, and body unchanged
- The original request headers
- The `requestId` header — generated at the gateway, used for log correlation
- The `x-user-id` and `x-user-role` headers — extracted from the validated JWT so downstream services do not need to re-verify the token

**Downstream services trust these headers** because they are set by the gateway after JWT validation. No request reaches a service without passing through the gateway first.

---

## Error Responses

Errors at the gateway level are returned before the request reaches any service:

| Status | Reason                                                    | Stage            |
| ------ | --------------------------------------------------------- | ---------------- |
| 401    | No token, invalid token, expired token, blacklisted token | JWT validation   |
| 403    | Role not allowed for this endpoint                        | RBAC check       |
| 429    | Rate limit exceeded                                       | Rate limit check |
| 502    | Downstream service unreachable                            | Routing          |

---

## Further Reading

| Topic                 | Location                                                  |
| --------------------- | --------------------------------------------------------- |
| Gateway overview      | [overview.md](../gateway/overview.md)                     |
| JWT validation detail | [auth.md](../../../../services/auth-service/docs/auth.md) |
| RBAC and roles        | [security.md](../docs/security.md)                        |
| Rate limiting         | [redis.md](../infrastructure/redis.md)                    |
| Service ports         | [service.md](../architecture/services.md)                 |
