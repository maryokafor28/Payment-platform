# RabbitMQ

## Version

V1

---

## Overview

RabbitMQ handles all background jobs and async event processing across the platform. It decouples services so the API always responds instantly — processing happens in the background without blocking the caller.

Every queue is **durable** — messages survive RabbitMQ restarts. No job is ever silently lost.

---

## Why RabbitMQ

| Requirement                        | How RabbitMQ Meets It                                           |
|------------------------------------|-----------------------------------------------------------------|
| Non-blocking API responses         | Jobs published to queue — caller moves on immediately           |
| Guaranteed delivery                | Durable queues survive restarts                                 |
| Retry on failure                   | Exponential backoff — failed jobs retried automatically         |
| Nothing silently lost              | Dead Letter Queue catches all exhausted jobs                    |
| Service decoupling                 | Publisher and consumer have no direct dependency on each other  |

---

## Sync vs Async Decision

RabbitMQ is used when the caller does not need to wait for the result. If the result is needed immediately, services use internal HTTP instead.

| Situation                                      | Use           |
|------------------------------------------------|---------------|
| Result needed before continuing                | HTTP (sync)   |
| Operation is a side effect of something done   | RabbitMQ (async) |
| Operation could be slow or need retries        | RabbitMQ (async) |
| Notifying another service of an event          | RabbitMQ (async) |

---

## Queues

### `payment.processing`

**Publisher:** Payment Service
**Consumer:** Payment Service

Handles the main payment processing job. When a payment request is received, it is published to this queue and processed asynchronously. This ensures the API responds immediately while the actual debit, credit, and transaction record happen in the background.

**Flow:**
```
POST /v1/payments/send received
      ↓
Payment Service publishes job to payment.processing
      ↓
Payment Service moves on — API responds immediately
      ↓
Consumer picks up job:
  → Verify account balance
  → Debit sender account
  → Credit receiver account
  → Record transaction (ACID)
      ↓
Result published to payment.success or payment.failed
```

---

### `payment.success`

**Publisher:** Payment Service
**Consumer:** Notification Service

Fired after a payment completes successfully. The Notification Service consumes this event and pushes an SSE update to the customer.

**Payload:**
```json
{
  "event": "payment.success",
  "transactionId": "uuid",
  "amount": 5000,
  "currency": "NGN",
  "timestamp": "2026-03-19T10:00:00Z"
}
```

---

### `payment.failed`

**Publisher:** Payment Service
**Consumer:** Notification Service

Fired when a payment fails — either due to insufficient balance, a system error, or processor rejection. The Notification Service consumes this and pushes an SSE failure update to the customer.

**Payload:**
```json
{
  "event": "payment.failed",
  "transactionId": "uuid",
  "reason": "insufficient_balance",
  "timestamp": "2026-03-19T10:00:00Z"
}
```

---

### `chat.messages`

**Publisher:** Support Service (WebSocket server)
**Consumer:** Support Service (Chat Router)

Every message sent through the chat UI is published to this queue. The Chat Router checks Redis to determine whether the session is assigned to a live agent or still with the AI, then routes accordingly.

**Flow:**
```
Customer sends message via WebSocket
      ↓
Published to chat.messages
      ↓
Chat Router checks Redis:
  Session assigned to agent? → deliver to agent
  No agent assigned?         → route to AI
      ↓
Reply saved to chat_messages table
Reply delivered via WebSocket
```

---

### `agent.escalation`

**Publisher:** Support Service
**Consumer:** Support Service (Chat Router)

Fired when a customer requests a live agent or when the AI confidence score drops below the escalation threshold. The Chat Router picks up the event, finds an available agent in Redis, and assigns the session.

**Flow:**
```
Customer: "I want a human"
OR AI confidence < threshold
      ↓
Escalation flag set in Redis for session
      ↓
Session published to agent.escalation
      ↓
Customer receives: "Connecting you to a live agent. Please hold."
      ↓
Chat Router checks Redis for available agent
      ↓
Agent found  → session assigned, agent receives full chat history
No agent     → message moved to offline.queue
```

---

### `offline.queue`

**Publisher:** Support Service
**Consumer:** Support Service

Handles messages when no agent is online. Messages are held durably in this queue and delivered when an agent comes online. The queue survives RabbitMQ restarts — no message is lost during downtime.

**Flow:**
```
No agent online
      ↓
Message saved to chat_messages (status = pending)
Message published to offline.queue (durable)
      ↓
Customer receives: "No agents available. We will respond within 24 hours."
      ↓
Agent comes online
      ↓
Redis availability flag updated
      ↓
RabbitMQ delivers pending messages from offline.queue
```

---

### `complaints`

**Publisher:** Support Service
**Consumer:** Notification Service

Fired on every complaint status change — when a complaint is created, moved to in review, resolved, or closed. The Notification Service consumes each event and pushes an SSE update to the customer.

**Flow:**
```
Customer lodges complaint → POST /v1/support/complaints
      ↓
Complaint saved (status = open)
Event published to complaints queue
      ↓
Notification Service → SSE to customer:
"Complaint #UUID received"
      ↓
Agent updates status → PATCH /v1/support/complaints/:id
      ↓
Notification Service → SSE to customer:
"Your complaint is now In Review"
```

---

## Queue Summary

| Queue                | Publisher        | Consumer             | Purpose                                        |
|----------------------|------------------|----------------------|------------------------------------------------|
| `payment.processing` | Payment Service  | Payment Service      | Main payment processing jobs                   |
| `payment.success`    | Payment Service  | Notification Service | SSE push on payment success                    |
| `payment.failed`     | Payment Service  | Notification Service | SSE push on payment failure                    |
| `chat.messages`      | Support Service  | Support Service      | AI and agent chat message routing              |
| `agent.escalation`   | Support Service  | Support Service      | Live agent escalation requests                 |
| `offline.queue`      | Support Service  | Support Service      | Pending messages when no agent is online       |
| `complaints`         | Support Service  | Notification Service | Complaint status change notifications          |

---

## Retry Logic

Any job that fails is automatically retried using exponential backoff. No failed job is ever silently discarded.

**Backoff schedule:**

| Attempt | Wait Before Retry |
|---------|-------------------|
| 1       | 30 seconds        |
| 2       | 1 minute          |
| 3       | 5 minutes         |
| 4       | 30 minutes        |

After all attempts are exhausted the message is moved to the Dead Letter Queue.

---

## Dead Letter Queue (DLQ)

Every failed message that exhausts all retries lands in the DLQ. Nothing is silently discarded — every failure is visible and actionable.

**DLQ handling:**

```
All retry attempts exhausted
      ↓
Message moved to Dead Letter Queue
      ↓
Admin dashboard alert fired
      ↓
Admin inspects message in DLQ
      ↓
Admin replays message   → reason recorded in audit log
OR
Admin discards message  → reason recorded in audit log
```

**Rule:** Every DLQ action — replay or discard — must have a reason recorded. Nothing leaves the DLQ silently.

---

## Durability

All queues are declared as **durable**. This means:

- Queue definitions survive RabbitMQ restarts
- Messages marked as persistent survive RabbitMQ restarts
- The `offline.queue` in particular must be durable — messages queued during agent downtime must not be lost if RabbitMQ restarts before an agent comes online

---

## Further Reading

| Topic                          | Location                                                              |
|--------------------------------|-----------------------------------------------------------------------|
| Redis usage across services    | [redis.md](../infrastructure/redis.md)                                |
| Payment processing detail      | [payment.md](../../../payment-service/docs/payment.md)                |
| Chat and escalation detail     | [support.md](../../../support-service/docs/support.md)                |
| SSE events                     | [notification.md](../../../notification-service/docs/notification.md) |
| End-to-end request flow        | [request-flow.md](../architecture/request-flow.md)                    |