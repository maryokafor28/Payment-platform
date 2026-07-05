# Services

## Version

V1

---

## Overview

The platform is made up of five independent services. Each service has its own codebase, runs on its own port, owns its own database schema, and can be deployed or scaled independently without affecting any other service.

---

## Service Summary

| Service              | Port | Schema          | Responsibility                                                                  |
| -------------------- | ---- | --------------- | ------------------------------------------------------------------------------- |
| API Gateway          | 3000 | —               | Single entry point — JWT validation, RBAC, rate limiting, routing, logging      |
| Auth Service         | 3001 | `auth`          | Registration, login, JWT issuance, logout, token blacklisting, password reset   |
| Payment Service      | 3002 | `payments`      | Send, receive, balance check, transaction history, idempotency                  |
| Notification Service | 3003 | `notifications` | SSE updates — payment status, complaint updates, agent alerts                   |
| Support Service      | 3004 | `support`       | WebSocket chat, AI routing, live agent escalation, complaints, agent management |

---

## API Gateway — Port 3000

The API Gateway is the only service exposed to the public internet. Every request from the mobile app, web app, or any external merchant system passes through the gateway before reaching any service.

**Responsibilities:**

- JWT validation — verifies every token before any request proceeds
- RBAC enforcement — checks the user's role against the requested endpoint
- Rate limiting — enforces request limits per user via shared Redis middleware
- Request routing — forwards each request to the correct downstream service
- Logging — records every incoming request in one central place

The gateway does not own any database schema. It reads from Redis only.

---

## Auth Service — Port 3001

The Auth Service owns everything related to identity and access.

**Responsibilities:**

- User registration — creates new accounts, always assigns the `customer` role
- Login — validates credentials, issues JWT access token and refresh token cookie
- Token refresh — generates a new access token from a valid refresh cookie
- Logout — blacklists the current access token in Redis, clears the refresh cookie
- Logout all devices — invalidates all refresh tokens for a user
- Password reset — time-limited single-use token flow via Redis
- Audit logging — writes all authentication events to the audit log

**Owns:** `auth` schema — `users`, `refresh_tokens`, `audit_logs` tables

---

## Payment Service — Port 3002

The Payment Service owns everything related to money movement.

**Responsibilities:**

- Send payment — debits sender, credits receiver in a single ACID transaction
- Receive payment — handles incoming payment confirmation
- Balance check — returns current account balance
- Transaction history — returns paginated list of transactions for a user
- Idempotency — deduplicates requests using Redis before processing
- Payment processor integration — processed internally via the platform's own payment engine
- Publishes payment events to RabbitMQ for async processing and notifications

**Owns:** `payments` schema — `accounts`, `transactions` tables

---

## Notification Service — Port 3003

The Notification Service owns all real-time push updates to clients.

**Responsibilities:**

- SSE (Server-Sent Events) — pushes one-way real-time updates to the client
- Consumes payment and complaint events from RabbitMQ
- Notifies customers of payment status changes
- Notifies customers of complaint status updates
- Notifies agents of new escalations and assignments

**Owns:** `notifications` schema — `notification_logs` table

**Technology:** SSE — server to client, one direction only. WebSockets are used by the Support Service for bidirectional chat.

---

## Support Service — Port 3004

The Support Service consolidates chat, AI routing, live agent escalation, agent management, and complaints into a single service.

**Why consolidated:** These features share the same database schema, the same WebSocket infrastructure, and the same agents. Splitting them into separate services would create coordination overhead with no real independence benefit.

**Responsibilities:**

- WebSocket chat — bidirectional real-time messaging between customer and agent or AI
- AI routing — every chat goes through the AI assistant first
- Live agent escalation — customer requests human, or AI confidence drops below threshold
- Offline handling — queues messages when no agent is available
- Complaint management — lodge, track, assign, and resolve complaints
- Agent availability — tracks online / offline / busy status via Redis

**Owns:** `support` schema — `support_agents`, `chat_sessions`, `chat_messages`, `complaints` tables

---

## Schema Ownership

Each service owns its schema exclusively. Services never query another service's tables directly. Cross-service data needs go through internal HTTP calls or RabbitMQ events.

| Schema          | Owner                | Tables                                                           |
| --------------- | -------------------- | ---------------------------------------------------------------- |
| `auth`          | Auth Service         | `users`, `refresh_tokens`, `audit_logs`                          |
| `payments`      | Payment Service      | `accounts`, `transactions`                                       |
| `notifications` | Notification Service | `notification_logs`                                              |
| `support`       | Support Service      | `support_agents`, `chat_sessions`, `chat_messages`, `complaints` |

---

## Further Reading

| Topic                    | Location                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| How services communicate | [communication.md](../architecture/communication.md)                  |
| End-to-end request flow  | [request-flow.md](../architecture/request-flow.md)                    |
| Auth Service detail      | [auth.md](../../../auth-service/docs/auth.md)                         |
| Payment Service detail   | [payment.md](../../../payment-service/docs/payment.md)                |
| Support Service detail   | [support.md](../../../support-service/docs/support.md)                |
| Notification Service     | [notification.md](../../../notification-service/docs/notification.md) |
| API Gateway detail       | [gateway.md](../gateway/overview.md)                                  |
