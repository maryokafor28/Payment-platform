# Request Flow

## Version

V1

---

## Overview

This document traces exactly what happens from the moment a client makes a request to the moment they receive a response. Two flows are covered — a payment request (the most complex path through the system) and a chat message (WebSocket path).

---

## Flow 1 — Send Payment

### Step by Step

```
1. Customer clicks Pay on the app

2. POST /v1/payments/send arrives at the API Gateway

3. Gateway — JWT validation
   Is the token valid?
   Is the token blacklisted in Redis?
   → No  → reject 401 Unauthorized
   → Yes → continue

4. Gateway — RBAC check
   Is this role allowed to call POST /v1/payments/send?
   → No  → reject 403 Forbidden
   → Yes → continue

5. Gateway — Rate limit check
   Has this user exceeded their request limit?
   → Yes → reject 429 Too Many Requests
   → No  → continue

6. Gateway routes request to Payment Service :3002

7. Payment Service — Idempotency check (Redis)
   Has this Idempotency-Key been seen before?
   → Yes → return previous result, no duplicate charge
   → No  → continue

8. Payment Service — Internal auth check (HTTP)
   Calls Auth Service: is this user active?
   → No  → reject
   → Yes → continue

9. Payment Service publishes job to RabbitMQ payment.processing queue

10. Payment Service consumes job
    Verifies account balance
    Debits sender account
    Credits receiver account
    Records transaction
    All in a single ACID transaction — full rollback if any step fails

11. Transaction result written to PostgreSQL

12. Payment Service publishes event to RabbitMQ
    → payment.success or payment.failed

13. Notification Service consumes event
    Pushes SSE update to customer

14. Customer sees real-time status update in the app
```

### Visual Summary

```
Customer clicks Pay
      ↓
API Gateway
  JWT valid?          ✓
  Role allowed?       ✓
  Rate limit okay?    ✓
      ↓
Payment Service
  Idempotency check (Redis)   ✓
  User active? (Auth Service) ✓
      ↓
RabbitMQ — payment.processing queue
      ↓
Payment Service
  Balance check
  Debit sender
  Credit receiver
  Record transaction
      ↓
PostgreSQL updated
      ↓
RabbitMQ — payment.success / payment.failed
      ↓
Notification Service
      ↓
SSE → Customer
```

---

## Flow 2 — Customer Sends a Chat Message

### Step by Step

```
1. Customer sends a message in the chat UI

2. Message arrives via WebSocket connection to Support Service :3004

3. Support Service publishes message to RabbitMQ chat.messages queue

4. Chat Router checks Redis:
   Is this session already assigned to a live agent?
   → Yes → route message to agent
   → No  → route to AI

5a. AI path:
    AI processes message
    Reply saved to chat_messages table
    Reply delivered to customer via WebSocket

5b. Agent path:
    Message delivered to assigned agent via WebSocket
    Agent reply saved and delivered back to customer
```

### Visual Summary

```
Customer sends message
      ↓
WebSocket → Support Service
      ↓
RabbitMQ — chat.messages
      ↓
Chat Router — Redis session check
      ↓
  ┌─────────────────┬──────────────────┐
  │   No agent      │   Agent assigned  │
  │   assigned      │                  │
  ↓                 ↓                  │
 AI processes    Agent receives        │
 message         message               │
  ↓                 ↓                  │
Reply → WebSocket → Customer
```

---

## Flow 3 — Live Agent Escalation

```
Customer types "I want a human"
OR AI confidence drops below threshold
      ↓
Escalation flag set in Redis for this session
      ↓
Session published to RabbitMQ — agent.escalation queue
      ↓
Customer receives: "Connecting you to a live agent. Please hold."
      ↓
Chat Router checks Redis for available agent
      ↓
Session assigned to agent
Agent receives full conversation history including AI exchange
      ↓
Agent responds via WebSocket → Customer
```

---

## Flow 4 — Complaint Status Update

```
Customer lodges complaint → POST /v1/support/complaints
      ↓
Complaint saved to PostgreSQL (status = open)
      ↓
Event published to RabbitMQ — complaints queue
      ↓
Notification Service → SSE to customer
"Complaint #UUID received"
      ↓
Agent updates status → PATCH /v1/support/complaints/:id
      ↓
Notification Service → SSE to customer
"Your complaint is now In Review"
```

---

## Further Reading

| Topic                     | Location                            |
| ------------------------- | ----------------------------------- |
| All services and ports    | `architecture/services.md`          |
| How services communicate  | `architecture/communication.md`     |
| RabbitMQ queues in detail | `infrastructure/rabbitmq.md`        |
| Idempotency               | `payment/docs/payment.md`           |
| JWT and token validation  | `auth/docs/auth.md`                 |
| RBAC enforcement          | `gateway/docs/rbac.md`              |
| SSE events                | `notification/docs/notification.md` |
