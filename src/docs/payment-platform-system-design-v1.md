# Payment Platform — System Design v1

---

## Table of Contents

- [1. System Overview](#1-system-overview)
- [2. Microservices Architecture](#2-microservices-architecture)
  - [2.1 Monolith vs Microservices](#21-monolith-vs-microservices)
  - [2.2 Service Breakdown](#22-service-breakdown)
  - [2.3 The API Gateway](#23-the-api-gateway)
  - [2.4 How Services Communicate](#24-how-services-communicate)
  - [2.5 End-to-End Request Flow](#25-end-to-end-request-flow)
  - [2.6 How Services Are Connected](#26-how-services-are-connected)
  - [2.7 Benefits of This Architecture](#27-benefits-of-this-architecture)
- [3. Database Layer](#3-database-layer)
  - [3.1 SQL Database](#31-sql-database-postgresql)
  - [3.2 Database Normalization](#32-database-normalization)
  - [3.3 UUID for Identifiers](#33-uuid-for-identifiers)
  - [3.4 Core Financial Tables](#34-core-financial-tables)
- [4. Security Layer](#4-security-layer)
  - [4.1 HTTPS Encryption](#41-https-encryption)
  - [4.2 Authentication](#42-authentication)
  - [4.3 Authentication Endpoints](#43-authentication-endpoints)
  - [4.4 Forgot Password and Password Reset](#44-forgot-password-and-password-reset)
  - [4.5 Rate Limiting](#45-rate-limiting)
- [5. Role-Based Access Control](#5-role-based-access-control)
  - [5.1 Role Definitions](#51-role-definitions)
  - [5.2 Login Routing](#52-login-routing)
  - [5.3 JWT Role Integration](#53-jwt-role-integration)
- [6. Core Backend Design](#6-core-backend-design)
  - [6.1 Idempotency](#61-idempotency)
  - [6.2 Payment API Endpoints](#62-payment-api-endpoints)
- [7. Performance Layer — Redis](#7-performance-layer--redis)
- [8. Asynchronous Processing — RabbitMQ](#8-asynchronous-processing--rabbitmq)
  - [8.1 Payment Processing Flow](#81-payment-processing-flow)
  - [8.2 AI Chat Flow](#82-ai-chat-flow)
  - [8.3 AI to Live Agent Escalation](#83-ai-to-live-agent-escalation)
  - [8.4 Offline Handling](#84-offline-handling)
  - [8.5 Complaint Notification Flow](#85-complaint-notification-flow)
  - [8.6 RabbitMQ Queues](#86-rabbitmq-queues)
- [9. Retry Logic and Dead Letter Queue](#9-retry-logic-and-dead-letter-queue)
- [10. Real-Time Updates](#10-real-time-updates)
- [11. Support Service](#11-support-service)
  - [11.1 Live Chat](#111-live-chat)
  - [11.2 Complaint and Dispute System](#112-complaint-and-dispute-system)
  - [11.3 Support Database Tables](#113-support-database-tables)
  - [11.4 Support API Endpoints](#114-support-api-endpoints)
- [12. Observability and Logging](#12-observability-and-logging)
- [13. Scalability Layer](#13-scalability-layer)
- [14. DevOps and CI/CD](#14-devops-and-cicd)
- [15. High Level Architecture](#15-high-level-architecture)
- [16. Key System Properties](#16-key-system-properties)

---

## 1. System Overview

This document describes the architecture and technical design for a secure, scalable payment processing platform. The platform enables users to:

- initiate payments
- process transactions securely
- track payment status
- receive real-time updates

The system prioritizes security, reliability, idempotent transactions, and horizontal scalability.

---

## 2. Microservices Architecture

The platform is built using a microservices architecture. Instead of one large program handling everything, the system is split into small independent services that each do one job. Each service has its own codebase, runs on its own server, and can be deployed or updated independently without affecting the rest of the platform.

### 2.1 Monolith vs Microservices

A monolith is one big program where everything lives together:

```
MONOLITH
┌──────────────────────────────────────────┐
│  Auth + Payments + Support + Notifications│
│  — all one program                        │
└──────────────────────────────────────────┘
```

Problem: if Support crashes → entire app goes down.

Microservices splits that into independent programs:

```
MICROSERVICES
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│   Auth   │  │ Payments │  │ Support  │  │Notif'n   │  │ Gateway  │
│ Service  │  │ Service  │  │ Service  │  │ Service  │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

If Support crashes → only support is affected. Payments keep running.

### 2.2 Service Breakdown

| Service              | Port | Responsibility                                                                          |
| -------------------- | ---- | --------------------------------------------------------------------------------------- |
| API Gateway          | 3000 | Single entry point — JWT validation, RBAC, rate limiting, routing, logging              |
| Auth Service         | 3001 | User registration, login, JWT issuance, logout, token blacklisting, password reset      |
| Payment Service      | 3002 | Send, receive, balance check, transaction history, idempotency                          |
| Notification Service | 3003 | SSE updates — payment status, complaint updates, agent alerts                           |
| Support Service      | 3004 | WebSocket chat, AI routing, live agent escalation, complaints, agent availability       |

**Why these five and not more:**

The original design had eight services. Chat Service, Support AI Service, Agent Service, and Complaint Service were merged into a single Support Service. They share the same database schema, the same WebSocket infrastructure, and the same agents — splitting them created unnecessary coordination overhead with no real independence benefit. The remaining four domain boundaries are genuine: auth, payments, notifications, and support each own entirely separate data and have no reason to be coupled.

### 2.3 The API Gateway

The API Gateway is the only entry point into the platform. The mobile app, web app, and any external merchant system never talk directly to any service. Every request goes through the gateway first.

The API Gateway is responsible for:

- JWT validation — checks every token before any request goes further
- RBAC enforcement — checks the user role against the requested endpoint
- Rate limiting — enforces 100 requests per minute per user via Redis
- Request routing — forwards each request to the correct microservice
- Logging — records every incoming request in one central place

### 2.4 How Services Communicate

Services communicate in two ways depending on whether they need an immediate answer.

**Synchronous — HTTP (when you need an answer right now):**
```
Payment Service → calls Auth Service internally
"Does this user UUID exist and is their account active?"
Auth Service replies immediately → "Yes"
Payment Service continues processing
```

**Asynchronous — RabbitMQ (when you do not need to wait):**
```
Payment Service → publishes "payment.success" event to RabbitMQ
Payment Service moves on immediately — does not wait
  ↓
Notification Service → sends SSE update to customer
```

### 2.5 End-to-End Request Flow

This is exactly what happens when a customer initiates a payment:

1. Customer clicks Pay on the app
2. Request arrives at the API Gateway
3. Gateway validates JWT — is the token valid and not blacklisted?
4. Gateway checks RBAC — is this role allowed to call `/v1/payments/send`?
5. Gateway checks rate limit — has this user exceeded 100 requests per minute?
6. Gateway routes request to Payment Service
7. Payment Service checks idempotency key in Redis — is this a duplicate request?
8. Payment Service publishes payment job to RabbitMQ payment queue
9. Payment Service consumes the job and calls Paystack/Flutterwave
10. Payment result written to SQL database
11. Payment Service publishes `payment.success` or `payment.failed` event
12. Notification Service consumes event → pushes SSE to customer
13. Customer sees real-time status update in the app

```
Customer clicks Pay
↓
API Gateway — JWT valid? ✓  Role allowed? ✓  Rate limit okay? ✓
↓
Payment Service — Idempotency check (Redis) ✓
↓
RabbitMQ — payment queue
↓
Payment Service → Paystack / Flutterwave
↓
SQL Database updated
↓
RabbitMQ — payment.success event
↓
Notification Service → SSE → Customer
```

### 2.6 How Services Are Connected

All services run inside Docker containers. They communicate over an internal private network and are never directly accessible from the outside world. Only the API Gateway has a public-facing address.

```
Public Internet
↓ HTTPS only
Load Balancer
↓
API Gateway :3000  (only public-facing service)
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

### 2.7 Benefits of This Architecture

| Benefit                | What It Means in Practice                                                        |
| ---------------------- | -------------------------------------------------------------------------------- |
| Fault isolation        | If the Support Service crashes, payments and auth continue working normally      |
| Independent deployment | You can update the Payment Service without redeploying the entire app            |
| Independent scaling    | If payments get heavy traffic, scale only the Payment Service — not everything   |
| Easier debugging       | Each service has its own logs — you know exactly which service caused an error   |
| Team friendly          | Different developers can own different services without stepping on each other   |

---

## 3. Database Layer

### 3.1 SQL Database (PostgreSQL)

PostgreSQL is used for all relational data. It is the industry standard for fintech and payment systems — strongest ACID compliance of any open-source SQL database, handles UUIDs natively, and supports row-level locking which matters for concurrent payment debits and credits.

Each service owns its own PostgreSQL schema. Services never query another service's tables directly.

```
PostgreSQL (one instance)
├── auth       schema → users, refresh_tokens, audit_logs
├── payments   schema → accounts, transactions
├── support    schema → support_agents, chat_sessions, chat_messages, complaints
└── notifications schema → notification_logs
```

**Payment flow ACID guarantee:**

1. Begin transaction
2. Verify account balance
3. Debit sender
4. Credit receiver
5. Record transaction
6. Commit — if any step fails, full rollback

### 3.2 Database Normalization

All tables follow third normal form (3NF). Every column in a table must describe that table's primary key, and nothing else.

Key decisions:
- User names, emails, and roles live only in `users`. No other table duplicates them.
- Account balance lives in `accounts`, not `users`. A user is a person; an account is a financial entity.
- Assigned chats are not stored as a list on the agent record — derived by querying `chat_sessions WHERE agent_id = ?`.
- `sender_role` on `chat_messages` is a justified exception — historical accuracy requires capturing the role at the time the message was sent.

### 3.3 UUID for Identifiers

All critical records use UUIDs — payment IDs, transaction IDs, user IDs, chat session IDs, complaint ticket IDs.

Benefits: globally unique, safe for distributed systems, prevents ID enumeration attacks.

### 3.4 Core Financial Tables

**users** — `auth` schema

| Field         | Type          | Description              |
| ------------- | ------------- | ------------------------ |
| user_id       | UUID PK       | Unique identifier        |
| email         | TEXT UNIQUE   | User email address       |
| password_hash | TEXT          | Hashed password          |
| role          | ENUM          | customer / agent / admin |
| created_at    | TIMESTAMPTZ   | Account creation time    |
| updated_at    | TIMESTAMPTZ   | Last profile update      |

**accounts** — `payments` schema

Separated from users because balance is a financial property, not a user property.

| Field      | Type        | Description              |
| ---------- | ----------- | ------------------------ |
| account_id | UUID PK     | Unique identifier        |
| user_id    | UUID FK     | References users.user_id |
| balance    | NUMERIC(20,8) | Current account balance |
| currency   | TEXT        | Currency code e.g. NGN   |
| status     | ENUM        | active / frozen / closed |
| created_at | TIMESTAMPTZ | Account creation         |
| updated_at | TIMESTAMPTZ | Last balance update      |

**transactions** — `payments` schema

References accounts, not users, because money moves between accounts.

| Field               | Type        | Description                    |
| ------------------- | ----------- | ------------------------------ |
| transaction_id      | UUID PK     | Unique identifier              |
| idempotency_key     | TEXT UNIQUE | Prevents duplicate processing  |
| sender_account_id   | UUID FK     | References accounts.account_id |
| receiver_account_id | UUID FK     | References accounts.account_id |
| amount              | NUMERIC(20,8) | Amount transferred           |
| currency            | TEXT        | Currency code                  |
| status              | ENUM        | pending / success / failed     |
| created_at          | TIMESTAMPTZ | When transaction was initiated |

---

## 4. Security Layer

### 4.1 HTTPS Encryption

All communication between client and server uses HTTPS. This encrypts sensitive data, prevents man-in-the-middle attacks, and protects authentication tokens.

### 4.2 Authentication

Authentication uses JSON Web Tokens (JWT) with two token types:

**Access Token** — returned in the response body, short lifespan (15 minutes), used for authenticated requests.

**Refresh Token** — stored in an HttpOnly cookie, longer lifespan (7 days), used to generate new access tokens.

Refresh token cookies must have `HttpOnly`, `Secure`, and `SameSite` flags set. This prevents XSS attacks, CSRF attacks, and token theft.

**Logout and Token Blacklisting:**

```
User clicks logout
↓
POST /v1/auth/logout
↓
Server stores access token in Redis blacklist
TTL = token's remaining lifespan (auto-deletes when expired)
↓
Refresh token cookie is cleared
↓
On every request, API Gateway checks Redis blacklist
↓
Blacklisted token → reject with 401 Unauthorized
```

### 4.3 Authentication Endpoints

| Method | Endpoint                    | Description                                             |
| ------ | --------------------------- | ------------------------------------------------------- |
| POST   | `/v1/auth/register`         | Register a new user — role auto-assigned: customer      |
| POST   | `/v1/auth/login`            | Login and receive JWT access token + refresh cookie     |
| POST   | `/v1/auth/refresh`          | Generate new access token using refresh cookie          |
| POST   | `/v1/auth/logout`           | Blacklist access token + clear refresh cookie           |
| POST   | `/v1/auth/logout/all`       | Logout from all devices — invalidate all refresh tokens |

### 4.4 Forgot Password and Password Reset

Password reset uses a time-limited, single-use token sent to the user's email. The token lives in Redis only — never in the database.

```
User submits email
↓
Server checks if email exists (always returns same response — prevents enumeration)
↓
If email exists:
  → Generate token with crypto.randomBytes
  → Store in Redis: key = password_reset:<token>, value = user_id, TTL = 15 minutes
  → Send reset link to email
↓
User submits new password with token
↓
Server validates token against Redis
↓
Token valid:
  → Hash new password → update users table
  → Delete token from Redis immediately (single-use)
  → Blacklist all active access tokens for this user
  → Clear all refresh token cookies
  → Return 200 OK
```

| Method | Endpoint                    | Description                                     |
| ------ | --------------------------- | ----------------------------------------------- |
| POST   | `/v1/auth/forgot-password`  | Accept email, send reset link if account exists |
| POST   | `/v1/auth/reset-password`   | Accept token and new password, update credentials |

**Redis keys:**

| Key                      | Value   | TTL        |
| ------------------------ | ------- | ---------- |
| `password_reset:<token>` | user_id | 15 minutes |

### 4.5 Rate Limiting

The `/v1/auth/forgot-password` endpoint is rate limited at 5 requests per hour per IP at the API Gateway to prevent inbox flooding and email system abuse.

---

## 5. Role-Based Access Control

### 5.1 Role Definitions

| Role          | Permissions                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Customer      | Start chats, send messages, lodge complaints, view own transaction history, check own complaint status                   |
| Support Agent | View assigned chat sessions, respond to customers, update complaint status                                               |
| Admin         | View all chats and complaints, assign agents, close tickets, manage agent accounts, access dashboards and analytics      |

### 5.2 Login Routing

There is a single login page. No role selection is shown. After login the server issues a JWT with the role baked in silently, and the frontend redirects based on that role.

```
User submits email + password
↓
Server checks role from database
↓
JWT issued with role inside
↓
Frontend redirects:
  customer → /dashboard
  agent    → /agent
  admin    → /admin
```

Route protection is enforced at two levels — frontend redirects on role mismatch, and the API Gateway returns 403 if the frontend is bypassed.

Customers can never self-assign a role. Registration always assigns `customer`. Agent and admin roles are assigned manually in the database.

### 5.3 JWT Role Integration

```json
{
  "userId": "uuid",
  "role": "customer | agent | admin",
  "exp": 1234567890
}
```

Every protected endpoint checks the role claim before allowing access. Unauthorized role access returns HTTP 403 Forbidden.

---

## 6. Core Backend Design

### 6.1 Idempotency

Payment requests must be idempotent. A network glitch may cause duplicate requests — without idempotency, two payments could be processed for a single user action.

```
Client sends request with Idempotency-Key header
↓
Server checks Redis for existing key
↓
Key exists    → return previous result (no duplicate charge)
Key not found → process payment and store result in Redis
```

### 6.2 Payment API Endpoints

| Method | Endpoint              | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| POST   | `/v1/payments/send`   | Initiate a payment to another user       |
| POST   | `/v1/payments/receive`| Receive an incoming payment              |
| GET    | `/v1/payments/:id`    | Get status of a specific payment         |
| GET    | `/v1/payments/history`| List all transactions for the user       |
| GET    | `/v1/accounts/balance`| Check account balance                    |

---

## 7. Performance Layer — Redis

Redis reduces database load and powers time-sensitive features across all services.

| Use Case               | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| Token blacklist        | Blacklisted JWTs stored with TTL matching token expiry    |
| Password reset tokens  | Single-use reset tokens with 15-minute TTL                |
| Idempotency keys       | Deduplication keys for payment requests                   |
| Rate limiting counters | Per-user request counters with 60-second windows          |
| Agent availability     | Online/offline/busy status for live chat routing          |
| Escalation flags       | Session escalation state for AI-to-agent handoff          |

**Rate limiting flow:**
```
User makes request
↓
Redis checks counter for that user
↓
Counter < 100 → allow and increment
Counter = 100 → block → return 429 Too Many Requests
After 60 seconds → counter resets
```

---

## 8. Asynchronous Processing — RabbitMQ

RabbitMQ handles all background jobs so the API always responds instantly and processing happens in the background.

### 8.1 Payment Processing Flow

```
User → Payment Request
↓
Payment Service → publishes to RabbitMQ payment queue
↓
Payment Service consumes job → calls Paystack / Flutterwave
↓
Database updated
↓
Notification Service triggered via payment.success event
```

### 8.2 AI Chat Flow

Every customer goes through the AI assistant first. A live agent is only involved if the customer requests one or the AI cannot resolve the issue.

```
Customer sends message
↓
WebSocket Server receives it
↓
Published to RabbitMQ → chat.messages exchange
↓
Chat Router checks: is this session assigned to a live agent?
↓
No → route to AI
↓
AI processes message → reply saved to DB → delivered via WebSocket
```

### 8.3 AI to Live Agent Escalation

```
Customer types "I want a human" OR AI confidence drops below threshold
↓
Escalation flag set in Redis for this session
↓
Session published to RabbitMQ → agent.escalation queue
↓
Customer receives: "Connecting you to a live agent. Please hold."
↓
Chat Router assigns session to available agent (Redis availability check)
↓
Agent receives full conversation history including AI exchange
↓
Agent responds via WebSocket
```

### 8.4 Offline Handling

```
No agent online → message saved to DB (status = pending)
↓
RabbitMQ holds message in offline.queue (durable — survives restarts)
↓
Customer receives: "No agents available. We will respond within 24 hours."
↓
When agent comes online → Redis updates availability flag
↓
RabbitMQ delivers pending messages from offline.queue
```

### 8.5 Complaint Notification Flow

```
Customer lodges complaint → POST /v1/support/complaints
↓
Complaint saved (status = open)
↓
Published to RabbitMQ → complaints exchange
↓
Notification Service → SSE to customer: "Complaint #UUID received"
↓
Agent updates status → PATCH /v1/support/complaints/:id
↓
Notification Service → SSE to customer: "Your complaint is now In Review"
```

### 8.6 RabbitMQ Queues

| Queue                | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `payment.processing` | Main payment processing jobs                  |
| `chat.messages`      | AI chat message routing                       |
| `agent.escalation`   | Live agent escalation requests                |
| `offline.queue`      | Pending messages when no agent is online      |
| `complaints`         | Complaint status change notifications         |

---

## 9. Retry Logic and Dead Letter Queue

Any background job that fails is automatically retried using exponential backoff. No failed job is ever silently lost.

**Exponential backoff:**
```
Attempt 1 → wait 30 seconds → retry
Attempt 2 → wait 1 minute   → retry
Attempt 3 → wait 5 minutes  → retry
Attempt 4 → wait 30 minutes → retry
All attempts exhausted → message moved to Dead Letter Queue
```

**Dead Letter Queue (DLQ):**

Every failed message lands in the DLQ for human inspection. Admin can replay or discard with a reason recorded in the audit log. Nothing is silently discarded.

---

## 10. Real-Time Updates

| Technology | Direction       | Use Case                                                        |
| ---------- | --------------- | --------------------------------------------------------------- |
| SSE        | Server → Client | Payment status, complaint updates, agent notifications          |
| WebSockets | Bidirectional   | Live chat between customer and AI or support agent              |

SSE events: payment status changes, transaction completion or failure, complaint status updates, new complaint assigned.

---

## 11. Support Service

The Support Service consolidates chat, AI routing, live agent escalation, agent management, and complaints into a single service. These features share the same database schema, the same WebSocket infrastructure, and the same agents — separating them would create coordination overhead with no independence benefit.

**Port:** 3004 — **Schema:** `support`

### 11.1 Live Chat

Every customer who opens chat goes through the AI assistant first. A live agent is only involved if the customer requests one or the AI cannot resolve the issue.

**Technology:**
- WebSockets — bidirectional real-time messaging
- RabbitMQ — message queuing, offline handling, AI routing
- Redis — agent availability tracking, escalation flags, session state

### 11.2 Complaint and Dispute System

Users can lodge complaints for failed transactions, incorrect debits, delayed payments, or unauthorized activity. Each complaint is tracked with a unique UUID ticket and real-time SSE status updates.

**Complaint lifecycle:** Open → In Review → Resolved → Closed

**Issue types:** failed transaction, wrong amount, delayed payment, unauthorized transaction, refund request, other.

### 11.3 Support Database Tables

**support_agents**

| Field               | Type      | Description                              |
| ------------------- | --------- | ---------------------------------------- |
| agent_id            | UUID PK   | Unique identifier for this agent profile |
| user_id             | UUID FK   | References auth.users.user_id            |
| availability_status | ENUM      | online / offline / busy                  |
| created_at          | TIMESTAMPTZ | When the agent account was created     |
| updated_at          | TIMESTAMPTZ | Last availability update               |

**chat_sessions**

`agent_id` is nullable — a session starts unassigned. Populated only when a customer escalates to a human agent.

| Field      | Type      | Description                                   |
| ---------- | --------- | --------------------------------------------- |
| session_id | UUID PK   | Unique identifier                             |
| user_id    | UUID FK   | References auth.users.user_id                 |
| agent_id   | UUID FK   | References support_agents.agent_id — nullable |
| status     | ENUM      | active / closed                               |
| created_at | TIMESTAMPTZ | When session was opened                     |
| closed_at  | TIMESTAMPTZ | When session was closed — nullable          |

**chat_messages**

`sender_role` is stored intentionally — if an agent's role later changes, the historical record must still reflect what role they held when the message was sent.

| Field       | Type      | Description                                            |
| ----------- | --------- | ------------------------------------------------------ |
| message_id  | UUID PK   | Unique identifier                                      |
| session_id  | UUID FK   | References chat_sessions.session_id                    |
| sender_id   | UUID FK   | References auth.users.user_id                          |
| sender_role | ENUM      | customer / agent / ai — stored for historical accuracy |
| content     | TEXT      | Message body                                           |
| status      | ENUM      | pending / delivered                                    |
| created_at  | TIMESTAMPTZ | When the message was sent                            |

**complaints**

`assigned_agent_id` is nullable — a complaint starts unassigned. Admin populates this via the assign endpoint.

| Field             | Type      | Description                                                         |
| ----------------- | --------- | ------------------------------------------------------------------- |
| complaint_id      | UUID PK   | Unique ticket identifier                                            |
| user_id           | UUID FK   | References auth.users.user_id                                       |
| transaction_id    | UUID FK   | References payments.transactions.transaction_id                     |
| assigned_agent_id | UUID FK   | References support_agents.agent_id — nullable until assigned        |
| issue_type        | ENUM      | failed_txn / wrong_amount / delayed / unauthorized / refund / other |
| description       | TEXT      | Customer description of the issue                                   |
| status            | ENUM      | open / in_review / resolved / closed                                |
| created_at        | TIMESTAMPTZ | When complaint was lodged                                         |
| updated_at        | TIMESTAMPTZ | Last status change                                                |

### 11.4 Support API Endpoints

**Chat**

| Method | Endpoint                              | Role            | Description                        |
| ------ | ------------------------------------- | --------------- | ---------------------------------- |
| POST   | `/v1/support/chat/start`              | Customer        | Start a new chat session           |
| GET    | `/v1/support/chat/:sessionId/messages`| Customer, Agent | Fetch full chat history            |
| POST   | `/v1/support/chat/:sessionId/send`    | Customer, Agent | Send a message in session          |
| PATCH  | `/v1/support/chat/:sessionId/close`   | Agent, Admin    | Close a chat session               |
| GET    | `/v1/support/chat/queue`              | Agent, Admin    | View pending unassigned chats      |
| PATCH  | `/v1/support/agents/availability`     | Agent           | Update agent online/offline status |

**Complaints**

| Method | Endpoint                              | Role                   | Description                          |
| ------ | ------------------------------------- | ---------------------- | ------------------------------------ |
| POST   | `/v1/support/complaints`              | Customer               | Lodge a new complaint                |
| GET    | `/v1/support/complaints/:id`          | Customer, Agent, Admin | Get complaint details and status     |
| GET    | `/v1/support/complaints/history`      | Customer               | List all complaints for the user     |
| PATCH  | `/v1/support/complaints/:id/update`   | Agent, Admin           | Update complaint status              |
| GET    | `/v1/support/complaints/all`          | Admin                  | View all complaints                  |
| PATCH  | `/v1/support/complaints/:id/assign`   | Admin                  | Assign complaint to an agent         |

---

## 12. Observability and Logging

The platform uses Pino for high-performance structured JSON logging.

Each service creates a named logger instance via the shared `createLogger` factory so every log line is identifiable by service in aggregation tools.

**Log levels:**

| Level | Purpose                                                                               |
| ----- | ------------------------------------------------------------------------------------- |
| info  | Normal operations — requests, payments, chat messages                                 |
| warn  | Unusual but recoverable — rate limit hit, agent unavailable, offline message queued   |
| error | Failures — payment failure, DB timeout, WebSocket disconnect                          |
| debug | Development only                                                                      |

**Security events logged:** failed login attempts, rate limit violations, 403 role access attempts, suspicious payment activity, authentication failures.

**Request correlation:** every request carries a Request ID that travels across all services so engineers can trace a payment end to end.

**Log pipeline:** Pino (JSON) → Log Aggregator (Elastic Stack / Grafana / Datadog) → Monitoring Dashboard.

---

## 13. Scalability Layer

- **Docker** — all services containerized for consistent environments and portable deployment
- **Kubernetes** — container orchestration, auto-scaling, service discovery, automatic restarts
- **Load Balancer** — distributes traffic across multiple instances of any service

Services scale independently. If payments get heavy traffic, only the Payment Service scales — not auth or support.

---

## 14. DevOps and CI/CD

```
Developer pushes code
↓
Automated tests run
↓
Docker image built
↓
Image pushed to registry
↓
Deployment to Kubernetes
```

---

## 15. High Level Architecture

```
Client
↓ HTTPS
Load Balancer
↓
API Gateway :3000 ←→ RBAC (JWT role check)
↓ internal private network
├── Auth Service         :3001
├── Payment Service      :3002
├── Notification Service :3003
└── Support Service      :3004
↕ all share
├── PostgreSQL  — financial records, user data, support history
├── Redis       — idempotency, blacklist, rate limits, agent status
└── RabbitMQ    — payment.processing, chat.messages, agent.escalation,
                  offline.queue, complaints
↓
Pino Logs → Log Aggregation → Monitoring Dashboard
```

---

## 16. Key System Properties

| Property         | Implementation                                                       |
| ---------------- | -------------------------------------------------------------------- |
| Security         | HTTPS + JWT + secure refresh tokens + RBAC enforcement               |
| Reliability      | Idempotent payments + durable RabbitMQ queues + DLQ                  |
| Consistency      | ACID transactions for all financial data                             |
| Scalability      | Docker + Kubernetes + independent service scaling                    |
| Performance      | Redis caching + async RabbitMQ processing                            |
| Observability    | Pino logging + request correlation + centralised monitoring          |
| Customer Support | WebSocket live chat + AI routing + complaint system + SSE updates    |
| Access Control   | RBAC — Customer / Support Agent / Admin role separation              |