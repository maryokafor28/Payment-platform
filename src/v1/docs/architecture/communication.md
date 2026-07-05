# Service Communication

## Version

V1

---

## Overview

Services communicate in two ways depending on whether they need an immediate response. Some operations require a direct answer before continuing — these use synchronous HTTP. Others can happen in the background without blocking the caller — these use asynchronous RabbitMQ messaging.

---

## Synchronous — HTTP (Internal)

Used when a service needs an answer right now before it can continue processing.

**When to use:**

- The result is needed to decide what to do next
- The operation must complete before a response is returned to the client

**Example — Payment Service calling Auth Service:**

```
Payment Service → HTTP GET → Auth Service
"Does this user UUID exist and is their account active?"
                ← "Yes, account is active"
Payment Service continues processing
```

The Payment Service cannot proceed without knowing the user is valid. It waits for the answer.

**Internal HTTP calls in this platform:**

| Caller          | Called       | Purpose                                    |
| --------------- | ------------ | ------------------------------------------ |
| Payment Service | Auth Service | Verify user exists and account is active   |
| API Gateway     | Redis        | Check token blacklist, check rate limit    |
| Support Service | Redis        | Check agent availability before escalation |

---

## Asynchronous — RabbitMQ

Used when the caller does not need to wait for the result. The job is published to a queue and processed in the background. The caller moves on immediately.

**When to use:**

- The result does not need to be returned to the client right now
- The operation could be slow or involve retries
- The operation is a side effect of something that already happened

**Example — Payment Service publishing a success event:**

```
Payment Service → publishes "payment.success" to RabbitMQ
Payment Service moves on immediately — does not wait
      ↓
Notification Service consumes event
      ↓
SSE update pushed to customer
```

The Payment Service does not wait for the customer to receive the notification. It just fires the event and continues.

**RabbitMQ queues in this platform:**

| Queue                | Publisher       | Consumer             | Purpose                                  |
| -------------------- | --------------- | -------------------- | ---------------------------------------- |
| `payment.processing` | Payment Service | Payment Service      | Main payment processing jobs             |
| `payment.success`    | Payment Service | Notification Service | Trigger SSE on successful payment        |
| `payment.failed`     | Payment Service | Notification Service | Trigger SSE on failed payment            |
| `chat.messages`      | Support Service | Support Service      | AI chat message routing                  |
| `agent.escalation`   | Support Service | Support Service      | Live agent escalation requests           |
| `offline.queue`      | Support Service | Support Service      | Pending messages when no agent is online |
| `complaints`         | Support Service | Notification Service | Complaint status change notifications    |

---

## Choosing Between Sync and Async

| Question                                         | Use              |
| ------------------------------------------------ | ---------------- |
| Do I need the result to continue?                | HTTP (sync)      |
| Can this happen in the background?               | RabbitMQ (async) |
| Could this operation be slow or need retries?    | RabbitMQ (async) |
| Is this a side effect of something already done? | RabbitMQ (async) |
| Must the client wait for this before responding? | HTTP (sync)      |

---

## How Services Are Connected

All services run on an internal private network inside Docker containers. They are never directly reachable from the public internet. Only the API Gateway has a public-facing address.

```
Public Internet
      ↓ HTTPS only
  Load Balancer
      ↓
API Gateway :3000          ← only public-facing service
      ↓ internal private network
  ├── Auth Service         :3001
  ├── Payment Service      :3002
  ├── Notification Service :3003
  └── Support Service      :3004
          ↕ all share
  ├── PostgreSQL
  ├── Redis
  └── RabbitMQ
```

---

## Further Reading

| Topic                         | Location                       |
| ----------------------------- | ------------------------------ |
| End-to-end request flow       | `architecture/request-flow.md` |
| All RabbitMQ queues in detail | `infrastructure/rabbitmq.md`   |
| Redis usage across services   | `infrastructure/redis.md`      |
| API Gateway routing           | `gateway/docs/gateway.md`      |
