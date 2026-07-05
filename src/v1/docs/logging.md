# Logging

## Version

V1

---

## Overview

The platform uses **Pino** for structured JSON logging across all services. Every log line is machine-readable, identifiable by service, and carries a request ID that links related events across services end to end.

Logs flow from each service into a central log aggregation system where they can be searched, filtered, and monitored in real time.

---

## Why Pino

| Requirement             | How Pino Meets It                                           |
| ----------------------- | ----------------------------------------------------------- |
| High performance        | Fastest Node.js logger — minimal overhead on every request  |
| Structured output       | JSON by default — parseable by any log aggregation tool     |
| Log levels              | `info`, `warn`, `error`, `debug` — filter by severity       |
| Readable in development | `pino-pretty` formats output for human reading locally      |
| Identifiable by service | Named logger instance per service via shared `createLogger` |

---

## Logger Setup

Each service creates its own named logger instance using a shared `createLogger` factory. This ensures every log line carries the service name so logs from different services can be distinguished in aggregation tools.

```typescript
// shared/utils/logger.ts
import pino from "pino";

export function createLogger(serviceName: string) {
  return pino({
    name: serviceName,
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty" }
        : undefined,
  });
}
```

```typescript
// inside each service
import { createLogger } from "@shared/utils/logger";

const logger = createLogger("auth-service");
```

Every log line from the auth service will carry `"name": "auth-service"` — making it trivial to filter in any aggregation tool.

---

## Log Levels

| Level   | When to Use                                                                 |
| ------- | --------------------------------------------------------------------------- |
| `info`  | Normal operations — requests received, payments processed, messages sent    |
| `warn`  | Unusual but recoverable — rate limit hit, agent unavailable, message queued |
| `error` | Failures — payment failure, DB timeout, WebSocket disconnect                |
| `debug` | Development only — verbose detail, never enabled in production              |

**Rule:** `debug` is never enabled in production. `LOG_LEVEL` is set via environment variable — `info` in production, `debug` locally when needed.

---

## Request Correlation

Every request carries a **Request ID** that is generated at the API Gateway and passed through to every service that handles that request. This allows engineers to trace a single payment or chat event end to end across multiple services and log lines.

```
Request arrives at API Gateway
      ↓
Gateway generates requestId (UUID)
      ↓
requestId attached to request headers
      ↓
Payment Service logs with requestId
RabbitMQ job carries requestId
Notification Service logs with requestId
      ↓
Search logs by requestId → full trace across all services
```

**Every log line includes:**

```json
{
  "level": "info",
  "name": "payment-service",
  "requestId": "uuid",
  "time": "2026-03-19T10:00:00Z",
  "msg": "Payment processed successfully",
  "transactionId": "uuid",
  "userId": "uuid"
}
```

---

## What Each Service Logs

### API Gateway

| Event                        | Level  |
| ---------------------------- | ------ |
| Incoming request received    | `info` |
| JWT validation failed        | `warn` |
| Role access denied (403)     | `warn` |
| Rate limit exceeded (429)    | `warn` |
| Request forwarded to service | `info` |

### Auth Service

| Event                          | Level   |
| ------------------------------ | ------- |
| User registered                | `info`  |
| Login successful               | `info`  |
| Login failed — wrong password  | `warn`  |
| Login failed — user not found  | `warn`  |
| Token blacklisted on logout    | `info`  |
| Password reset requested       | `info`  |
| Password reset completed       | `info`  |
| Multiple failed login attempts | `warn`  |
| Authentication error           | `error` |

### Payment Service

| Event                             | Level   |
| --------------------------------- | ------- |
| Payment initiated                 | `info`  |
| Idempotency key found — duplicate | `warn`  |
| Balance check passed              | `info`  |
| Payment processed successfully    | `info`  |
| Payment failed                    | `error` |
| DB transaction rolled back        | `error` |

### Support Service

| Event                       | Level   |
| --------------------------- | ------- |
| Chat session started        | `info`  |
| Message routed to AI        | `info`  |
| Escalation to live agent    | `info`  |
| No agent available — queued | `warn`  |
| Agent came online           | `info`  |
| Complaint lodged            | `info`  |
| Complaint status updated    | `info`  |
| WebSocket disconnected      | `error` |

### Notification Service

| Event               | Level   |
| ------------------- | ------- |
| SSE event published | `info`  |
| SSE delivery failed | `error` |
| Client reconnected  | `info`  |

---

## Security Events

Security-related events are logged at `warn` or `error` level and always include the `requestId`, `ip_address`, and `userId` where available. These feed directly into monitoring alerts.

| Event                          | Level   |
| ------------------------------ | ------- |
| Rate limit exceeded            | `warn`  |
| Multiple failed login attempts | `warn`  |
| 403 unauthorized role access   | `warn`  |
| Suspicious payment activity    | `warn`  |
| Authentication failure         | `error` |
| Fraud flag triggered           | `error` |

---

## Log Pipeline

```
Each service
Pino (structured JSON)
      ↓
Log Aggregator
(Elastic Stack / Grafana Loki / Datadog)
      ↓
Monitoring Dashboard
      ↓
Alerts → Email / Slack / SMS
```

In development, `pino-pretty` formats logs for human reading in the terminal. In production, raw JSON is shipped to the log aggregator.

---

## Log Retention

| Environment | Retention                                         |
| ----------- | ------------------------------------------------- |
| Production  | 90 days minimum — longer for audit and compliance |
| Staging     | 30 days                                           |
| Development | Local only — not shipped                          |

---

## Further Reading

| Topic                        | Location                                          |
| ---------------------------- | ------------------------------------------------- |
| Monitoring and alerts        | [kubernetes.md](../infrastructure/kubernates.md)  |
| Audit logs (security record) | [database.md](../docs/infrastructure/database.md) |
| Auth Service logging detail  | [auth.md](../../../auth-service/docs/auth.md)     |
| Payment Service logging      | [payment.md](../../../auth-service/docs/auth.md)  |
