## PAYMENT PLATFORM – TECHNICAL SPECIFICATION (BUILD ORDER)

## 1. System overview

This document describes the architecture and technical design for a secure, scalable payment processing platform.
The platform enables users to:

- initiate payments
- process transactions securely
- track payment status
- receive real-time updates
  ### The system prioritizes:
- security
- reliability
- idempotent transactions
- horizontal scalability

---

## 2. Microservices Architecture

The platform is built using a microservices architecture. Instead of one large program handling everything, the system is split into small independent services that each do one job. Each service has its own codebase, runs on its own server, and can be deployed or updated independently without affecting the rest of the platform.

### 2.1 Monolith vs Microservices — Simply Explained

A monolith is one big program where everything lives together:

```
MONOLITH
┌──────────────────────────────────────────┐
│  Auth + Payments + Chat + Complaints     │
│  + Notifications — all one program       │
└──────────────────────────────────────────┘
```

Problem: if Chat crashes → entire app goes down

Microservices splits that into independent programs:

```
MICROSERVICES
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│   Auth   │  │ Payments │  │   Chat   │  │Complaints│
│ Service  │  │ Service  │  │ Service  │  │ Service  │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

If Chat crashes → only chat is affected. Payments keep running.

### 2.2 Service Breakdown

The platform is divided into the following services:

| Service              | Responsibility                                                     |
| -------------------- | ------------------------------------------------------------------ |
| Auth Service         | User registration, login, JWT issuance, logout, token blacklisting |
| Payment Service      | Send, receive, balance check, transaction history, idempotency     |
| Notification Service | SSE updates — payment status, complaint updates, agent alerts      |
| Chat Service         | WebSocket connections, AI chat routing, session management         |
| Support AI Service   | AI model inference, response generation, escalation scoring        |
| Agent Service        | Live agent escalation, agent dashboard, availability tracking      |
| Complaint Service    | Lodge complaints, status updates, assignment to agents             |
| API Gateway          | Single entry point — auth, RBAC, rate limiting, routing, logging   |

### 2.3 The API Gateway — Your Single Front Door

The API Gateway is the only entry point into the platform. The mobile app, web app, and any external merchant system never talk directly to any service. Every request goes through the gateway first.

WITHOUT Gateway (wrong):

- Mobile App → directly hits Payment Service
- Mobile App → directly hits Auth Service
- Mobile App → directly hits Chat Service

Every service is exposed. No central auth or rate limiting.

WITH Gateway (correct):
Mobile App → API Gateway → routes to the right service

Only one entry point. Auth and rate limiting enforced once.

The API Gateway is responsible for:

- JWT validation — checks every token before any request goes further
- RBAC enforcement — checks the user role against the requested endpoint
- Rate limiting — enforces 100 requests per minute per user via Redis
- Request routing — forwards each request to the correct microservice
- Logging — records every incoming request in one central place

### 2.4 How Services Communicate

Services never talk directly to each other over the internet. They communicate in two ways depending on whether they need an immediate answer:

Synchronous — direct call (when you need an answer right now):

- Payment Service → calls Auth Service internally
- Does this user UUID exist and is their account active?'
- Auth Service replies immediately → 'Yes'
- Payment Service continues processing

Asynchronous — RabbitMQ message queue (when you do not need to wait):

- Payment Service → publishes 'payment.success' event to RabbitMQ
- Payment Service moves on immediately — does not wait
  ↓
- Multiple services consume that event independently:
- Notification Service → sends SSE update to customer
- Audit Service → writes audit log entry
- Webhook Service → fires webhook to merchant (v2)

### 2.5 End-to-End Request Flow — Customer Clicks Pay

This is exactly what happens when a customer initiates a payment, step by step:

1. Customer clicks Pay on the app
2. Request arrives at the API Gateway
3. Gateway validates JWT — is the token valid and not blacklisted?
4. Gateway checks RBAC — is this role allowed to call /v1/payments/send?
5. Gateway checks rate limit — has this user exceeded 100 requests per minute?
6. Gateway routes request to Payment Service
7. Payment Service checks idempotency key in Redis — is this a duplicate request?
8. Payment Service publishes payment job to RabbitMQ payment queue
9. Payment Processor Service consumes the job and calls Paystack/Flutterwave
10. Payment result (success or failed) written to SQL database
11. Payment Service publishes 'payment.success' or 'payment.failed' event
12. Notification Service consumes event → pushes SSE to customer
13. Customer sees real-time status update in the app

```
Customer clicks Pay
↓
API Gateway
JWT valid? ✓ Role allowed? ✓ Rate limit okay? ✓
↓
Payment Service
Idempotency check (Redis) ✓
↓
RabbitMQ — payment queue
↓
Payment Processor Service → Paystack / Flutterwave
↓
SQL Database updated
↓
RabbitMQ — payment.success event
↓ ↓
Notification Service Audit Service
SSE → Customer Audit log entry written
```

### 2.6 How Services Are Connected

All services run inside Docker containers managed by Kubernetes. They communicate over an internal private network — they are never directly accessible from the outside world. Only the API Gateway has a public-facing address.

Public Internet

```
↓ HTTPS only
Load Balancer
↓
API Gateway (only public-facing service)
↓ internal private network
├── Auth Service :3001
├── Payment Service :3002
├── Notification Service:3003
├── Chat Service :3004
├── Support AI Service :3005
├── Agent Service :3006
└── Complaint Service :3007
↕ all share
├── SQL Database
├── Redis
└── RabbitMQ
```

### 2.7 Benefits of This Architecture

| Benefit                | What It Means in Practice                                                      |
| ---------------------- | ------------------------------------------------------------------------------ |
| Fault isolation        | If the Chat Service crashes, payments and auth continue working normally       |
| Independent deployment | You can update the Complaint Service without redeploying the entire app        |
| Independent scaling    | If payments get heavy traffic, scale only the Payment Service — not everything |
| Easier debugging       | Each service has its own logs. You know exactly which service caused an error  |
| Team friendly          | Different developers can own different services without stepping on each other |

---

## 3. DATABASE LAYER

The platform uses a hybrid database architecture.

### 3.1 SQL Database

Relational databases store financial data.
Example tables: users, transactions, payments, accounts

### Requirements:

- ACID compliance :
  - Atomicity → All or nothing
  - Consistency → Database rules stay valid
  - Isolation → Transactions don't interfere
  - Durability → Data never disappears
- strong consistency
- transactional guarantees
  - Why SQL: Financial operations must be atomic and reliable.

    Financial transactions must follow ACID guarantees.

### Payment flow:

1. Begin transaction
2. Verify account balance
3. Debit sender
4. Credit receiver
5. Record transaction
6. Commit transaction
   If any step fails, the system performs a rollback.

### 3.2 UUID for Identifiers

All critical records use UUIDs including payment IDs, transaction IDs, order IDs, user IDs, chat session IDs, and complaint ticket IDs.

### Benefits:

- globally unique
- safe for distributed systems
- prevents ID collisions

---

## 4. Security layer

Security is the highest priority in a payment system.

### 4.1 HTTPS Encryption

All communication between client and server must use HTTPS.
Benefits:

- encrypts sensitive data
- prevents man-in-the-middle attacks
- protects authentication tokens

### 4.2 Authentication

Authentication will be implemented using JSON Web Tokens (JWT).
JWT Structure — A JWT contains three parts: Header, Payload, Signature.
Token Strategy — Two token types will be used:

### Access Token:

- returned in the response body
- short lifespan
- used for authenticated requests
  Refresh Token:
- stored in HttpOnly cookies
- used to generate new access tokens
- longer lifespan

### Refresh Token Security — Refresh tokens must include:

- HttpOnly cookie
- Secure flag
- SameSite protection
  This prevents XSS attacks, CSRF attacks, and token theft.
  Security Stack:

  ```
  HTTPS
   ↓
  JWT Authentication
   ↓
  Refresh Tokens (HttpOnly Cookies)
  ```

### Logout and Token Blacklisting

```
User clicks logout
        ↓
POST /auth/logout
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

| Endpoint            | Method | Description                                             |
| ------------------- | ------ | ------------------------------------------------------- |
| /v1/auth/register   | POST   | Register a new user — role auto-assigned: customer      |
| /v1/auth/login      | POST   | Login and receive JWT access token + refresh cookie     |
| /v1/auth/refresh    | POST   | Generate new access token using refresh cookie          |
| /v1/auth/logout     | POST   | Blacklist access token + clear refresh cookie           |
| /v1/auth/logout/all | POST   | Logout from all devices — invalidate all refresh tokens |

---

## 5. Role-Based Access Control (RBAC)

The platform implements Role-Based Access Control to manage permissions across three user types: Customer, Support Agent, and Admin. The user role is embedded in the JWT payload and validated at the API Gateway before any request reaches backe

### 5.1 Role Definitions

| Role          | Permissions                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Customer      | Start chats, send messages, lodge complaints, view own transaction history, check own complaint status                       |
| Support Agent | View assigned chat sessions, respond to customers, update complaint status (Open → In Review → Resolved)                     |
| Admin         | View all chats and complaints, assign agents, close/escalate tickets, manage agent accounts, access dashboards and analytics |

- LOGIN ROUTING
  How Login Works:
  There is a single login page at payment.com/login.(not yet the address) No role selection is shown to the user. After login, the server issues a JWT with the user's role baked in silently, and the frontend automatically redirects them based on that role.

payment.com/login

Email: [____________]
Password: [____________]
[ Login ]

No role selection. No dropdown. Just email and password.
After Login — Automatic Redirect:

```
User submits email + password
        ↓
Server checks database for that account's role
        ↓
JWT issued silently with role inside
        ↓
Frontend reads role and redirects:

  customer  →  payment.com/dashboard
  agent     →  payment.com/agent
  admin     →  payment.com/admin
```

- Route Protection:

```
User manually types payment.com/admin
        ↓
Frontend checks JWT role
        ↓
Role is not "admin" → redirect to /dashboard immediately
        ↓
Even if frontend is bypassed → API Gateway blocks with 403
```

| How                                                 | Role Given                       |
| --------------------------------------------------- | -------------------------------- |
| User signs up via payment.com/register              | Always customer — automatic      |
| You manually onboard a staff member in the database | agent or admin — assigned by you |

Customers can never self-upgrade their role. Role is locked to the account in the database, not chosen at login.

### 4.2 JWT Role Integration

The JWT payload must include a role field on all authenticated requests:

```json
{ "userId": "uuid", "role": "customer" | "agent" | "admin", "exp": 1234567890 }
```

## Every support endpoint checks the role claim before allowing access. Unauthorized role access returns HTTP 403 Forbidden.

## 6. CORE BACKEND DESIGN

### 6.2 Idempotency

Payment requests must be idempotent.
Problem — A network glitch may cause duplicate requests. Without idempotency, two payments could be processed for a single user action.
Example: User clicks Pay → Network delay → User clicks Pay again → Without idempotency: Two payments processed ❌
Solution — Use Idempotency Keys.

### Workflow:

- Client sends request with Idempotency-Key
- Server checks Redis for existing key
- If key exists → return previous result (no duplicate charge)
- If key does not exist → process payment and store result
  Benefits: prevents duplicate payments, ensures transaction safety.

### 6.3 Payment API Endpoints

These are the core APIs the platform exposes:
Endpoint Method Description

| Endpoint          | Method | Description                                   |
| ----------------- | ------ | --------------------------------------------- |
| /payments/send    | POST   | Initiate a payment to another user            |
| /payments/receive | POST   | Receive/accept an incoming payment            |
| /payments/:id     | GET    | Get status of a specific payment              |
| /payments/history | GET    | List all transactions for a user              |
| /accounts/balance | GET    | Check account balance                         |
| /auth/register    | POST   | Register a new user                           |
| /auth/login       | POST   | Login and receive tokens                      |
| /auth/refresh     | POST   | Refresh access token                          |
| /auth/logout      | POST   | Blacklist access token + clear refresh cookie |
| /auth/logout/all  | POST   | Logout from all devices                       |

---

## 7. PERFORMANCE LAYER — REDIS CACHE

Redis will be used to reduce database load.
Use cases:

- caching frequently accessed data
- session storage
- rate limiting counters : Redis tracks how many requests each user makes within a time window.
- idempotency key storage
- Agent availabilty tracking (for live chat routing)

Rate Limiting Flow:

```
User makes request
        ↓
Redis checks counter for that user
        ↓
Counter < 100 → allow request → increment counter
        ↓
Counter = 100 → block request → return 429 Too Many Requests
        ↓
After 60 seconds → counter resets
```

- Cache Flow

```

API Request
↓
Redis Cache
↓
Database (if cache miss)

```

Benefits: faster response time, reduced database load.

---

## 8. API PROTECTION LAYER

### 8.1 Rate Limiting

Rate limiting prevents API abuse.
Example policy: 100 requests per minute per user
Protects against: bots, brute force attacks, API abuse

- Implementation: Redis-based rate limiting

### 8.2 API Gateway

An API Gateway will sit in front of backend services.
Responsibilities:

- authentication validation (JWT + RBAC role check)
- rate limiting enforcement
- request routing to correct microservice
- logging and monitoring

```
Client
  ↓
API Gateway
  ↓
Backend Services
```

---

## 9. ASYNCHRONOUS PROCESSING - RABBITMQ

Payment processing avoids blocking requests. RabbitMQ handles all background jobs — payments, AI chat routing, live agent escalation, complaint notifications — so the API always responds instantly and processing happens in the background.

### 9.1 Payment Processing Flow:

```

User → Payment Request
↓
API Server → publishes to RabbitMq payment queue
↓
Payment Processor Service consumes the message
↓
Database updated
↓
Notification Service triggered

```

Benefits: retries, reliability, failure isolation, background processing.

### 9.2 AI Chat Flow — First Response (All Customers)

Every customer who opens the chat goes through the AI assistant first. The AI handles common queries automatically. A live agent is only involved if the customer requests one or the AI cannot resolve the issue.

```
Customer opens chat and sends a message
  ↓  WebSocket Server receives it
  ↓  Published to RabbitMQ → 'chat.messages' exchange
  ↓  Chat Router checks: is this session assigned to a live agent?
  ↓  No → route to AI Chat Service
  ↓  AI processes message using trained support model
     (handles: failed transactions, balance queries, complaint status,
      payment instructions, FAQs)
  ↓  AI reply saved to DB (chat_messages table)
  ↓  AI response delivered to customer via WebSocket
```

### 9.3 AI to Live Agent Escalation

The customer can request a live agent at any point. The AI also escalates automatically if it cannot confidently resolve the issue.

Customer types: 'I want to speak to a human' / 'Live agent'
OR
AI confidence score drops below threshold after 3 attempts
↓ Escalation flag set in Redis for this session
↓ Session published to RabbitMQ → 'agent.escalation' queue
↓ Customer receives message:
'Connecting you to a live agent. Please hold.'
↓ Chat Router assigns session to available agent (Redis availability check)
↓ Agent receives full conversation history including AI exchange
↓ Agent responds via WebSocket — customer sees reply in real time

### 9.4 Offline Handling — No Agent Available

When no support agent is online, the system handles messages durably without loss:

```

Customer sends message
  ↓
WebSocket Server receives it
  ↓
Published to RabbitMQ → 'chat.messages' exchange
  ↓
Chat Processor checks agent availability (Redis)
  ↓
No agent online → message saved to DB (status = 'pending')
  ↓
RabbitMQ holds message in 'offline.queue' (durable — survives restarts)
  ↓
Customer receives auto-reply:
  'No agents available. We will respond within 24 hours.'
  ↓
When agent comes online → Redis updates availability flag
  ↓
RabbitMQ delivers pending messages from 'offline.queue'
  ↓
Agent sees full conversation history
  ↓
Agent replies → SSE pushes notification to customer
```

Key property: The 'offline.queue' is durable, meaning messages survive server restarts and are never lost even if the system goes down between the customer sending and the agent coming online.

### 8.5 Complaint Notification Flow

```
Customer lodges complaint → POST /support/complaints
  ↓
API saves complaint (status = 'Open')
  ↓
Published to RabbitMQ → 'complaints' exchange
  ↓
Notification Service consumes event
  ↓
SSE pushes to customer: 'Complaint #UUID received'
  ↓
Admin dashboard receives alert: 'New complaint assigned'
  ↓
Agent updates status → PATCH /support/complaints/:id
  ↓
RabbitMQ → Notification Service
  ↓
SSE pushes to customer: 'Your complaint is now In Review'
```

---

## 10. Retry Logic and Dead Letter Queue (DLQ)

Any background job that fails — webhook delivery, payment processing, notification — is automatically retried by RabbitMQ using exponential backoff. No failed job is ever silently lost.

### 10.1 Exponential Backoff

Job fails on first attempt
↓ Attempt 1 → wait 30 seconds → retry

↓ Attempt 2 → wait 1 minute → retry

↓ Attempt 3 → wait 5 minutes → retry

↓ Attempt 4 → wait 30 minutes → retry

↓ All attempts exhausted

↓ Message moved to Dead Letter Queue

Exponential backoff means each retry waits longer than the last. This prevents the system from hammering a service that is already struggling to recover.

### 10.2 Dead Letter Queue

The DLQ is a holding area for messages that have failed all retries. Nothing is silently discarded — every failed message lands here for human inspection.

Message enters Dead Letter Queue
↓ Admin dashboard shows: 3 messages in DLQ

↓ Admin inspects: what failed, why, how many attempts

↓ Options: - Fix the issue → manually replay the message - Discard it → reason recorded in audit log

| Queue              | Purpose                                     |
| ------------------ | ------------------------------------------- |
| payment.processing | Main payment processing jobs                |
| chat.messages      | AI chat message routing                     |
| agent.escalation   | live agent escalation requests              |
| offline.queue      | pending escalations when no agent is online |
| complaints         | complaint status change notificatuions      |

---

## 11. Real-Time Updates

Clients receive live updates via Server-Sent Events (SSE) for payment events, and WebSockets for bidirectional chat communication.

| Technology               | Direction            | Use Case                                                      |
| ------------------------ | -------------------- | ------------------------------------------------------------- |
| SSE (Server-Sent Events) | Server → Client only | Payment status, complaint status updates, agent notifications |
| WebSockets               | Bidirectional        | Live chat between customer to AI and support agent            |

SSE Events:

- Payment status changes
- Transaction completion or failure
- Complaint status updates (Open → In Review → Resolved)
- New complaint assigned (agent/admin)

---

## 12. Customer Support Features

### 12.1 Inbuilt Live Chat

The platform provides a real-time chat widget enabling customers to communicate with support agents directly within the application. No redirect to external services.

Technology Stack:

- WebSockets — bidirectional real-time messaging
- RabbitMQ — message queuing, offline handling, routing
- Redis — agent availability tracking, active session management

Components:

- Customer-facing chat widget (floating button, all pages)
- Agent dashboard — web interface for agents to read and respond
- Queue system — routes incoming chats to available agents via RabbitMQ
- Offline fallback — durable queue stores messages when no agents online
- Auto-reply — customer notified when agents are unavailable

### New Database Tables:

| Table          | Key Fields                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| chat_sessions  | session_id (UUID), user_id, agent_id, status (active/closed), created_at, closed_at                   |
| chat_messages  | message_id (UUID), session_id, sender_id, sender_role, content, status (pending/delivered), timestamp |
| support_agents | agent_id (UUID), user_id, name, availability_status (online/offline/busy), assigned_chats             |

### Live Chat API Endpoints

| Endpoint                          | Method | Role            | Description                        |
| --------------------------------- | ------ | --------------- | ---------------------------------- |
| /support/chat/start               | POST   | Customer        | Start a new chat session           |
| /support/chat/:sessionId/messages | GET    | Customer, Agent | Fetch full chat history            |
| /support/chat/:sessionId/send     | POST   | Customer, Agent | Send a message in session          |
| /support/chat/:sessionId/close    | PATCH  | Agent, Admin    | Close/end a chat session           |
| /support/chat/queue               | GET    | Agent, Admin    | View pending/unassigned chats      |
| /support/agents/availability      | PATCH  | Agent           | Update agent online/offline status |

### 12.2 Complaint & Dispute System

Users can lodge complaints for issues such as failed transactions, incorrect debits, delayed payments, or unauthorized activity. Each complaint is tracked with a unique ticket and real-time status updates.

Complaint Lifecycle:
Open → In Review → Resolved → Closed

System Behaviour:
• Each complaint is assigned a unique UUID ticket number
• System auto-links the relevant transaction record from user history
• Status changes trigger SSE notifications to the customer in real time
• Admin dashboard receives alerts on new complaint submissions

Complaint Types (Issue Categories):
• Failed transaction
• Wrong amount debited
• Delayed payment
• Unauthorized transaction
• Refund request
• Other

### New Database Table — complaints:

| Field          | Type      | Description                                                              |
| -------------- | --------- | ------------------------------------------------------------------------ |
| complaint_id   | UUID      | Unique ticket identifier                                                 |
| user_id        | UUID      | Customer who lodged the complaint                                        |
| transaction_id | UUID      | Auto-linked transaction record                                           |
| issue_type     | ENUM      | Category: failed_txn, wrong_amount, delayed, unauthorized, refund, other |
| description    | TEXT      | Customer's description of the issue                                      |
| status         | ENUM      | open/ in review,/resolved/closed                                         |
| created_at     | TIMESTAMP | When complaint was lodged                                                |
| updated_at     | TIMESTAMP | Last status change time                                                  |

### Complaint API Endpoints

| Endpoint                       | Method | Role                   | Description                          |
| ------------------------------ | ------ | ---------------------- | ------------------------------------ |
| /support/complaints            | POST   | Customer               | Lodge a new complaint                |
| /support/complaints/:id        | GET    | Customer, Agent, Admin | Get complaint details and status     |
| /support/complaints/history    | GET    | Customer               | List all complaints for the user     |
| /support/complaints/:id/update | PATCH  | Agent, Admin           | Update complaint status              |
| /support/complaints/all        | GET    | Admin                  | View all complaints across all users |
| /support/complaints/:id/assign | PATCH  | Admin                  | Assign complaint to a specific agent |

---

## 16. OBSERVABILITY & LOGGING

Reliable payment systems must provide structured logging to monitor transactions, detect failures, and assist debugging.
The platform will use Pino for high-performance logging.
Reasons for using Pino:

- extremely fast, structured JSON logs, production ready, integrates easily with monitoring tools.

### 13.1 Logging Strategy

Logs will be generated at multiple system layers:

- API Layer — Log incoming requests (endpoint accessed, request ID, user ID, response time).

- Payment Processing — Critical payment events must be logged (payment initiated, processed, failed, duplicate prevented).

- Error Logging — System errors must be logged for investigation.

### 13.2 REQUEST CORRELATION

- Each request should have a Request ID that travels across all services so engineers can trace a payment end to end.

### 13.3 Log Levels

| Level | Purpose                                                                             |
| ----- | ----------------------------------------------------------------------------------- |
| info  | normal operations - request,payments, cha messages sent                             |
| warn  | Unusual but recoverable — rate limit hit, agent unavailable, offline message queued |
| error | Failures — payment failure, DB timeout, WebSocket disconnect                        |
| debug | development debugging                                                               |

### 13.4 Log Storage

- Application Servers → Pino Logs (JSON) → Log Aggregation → Monitoring Dashboard
  Examples of log platforms: Elastic Stack, Grafana, Datadog.

### 13.5 Security Logging

Sensitive events must be logged: failed login attempts, suspicious payment activity, rate limit violations, authentication failures.unauthorized role access (403 events).

### 13.6 Performance Metrics

Logs will track: request latency, payment processing time, queue processing delays, database query performance.

---

## 14. SCALABILITY LAYER

### 14.1 Docker

The application will be containerized using Docker.

- Benefits: consistent environments, easier deployment, portability.

### 14.2 Kubernetes

Kubernetes will orchestrate containers.

- Responsibilities: container scheduling, auto-scaling, service discovery, automatic restarts.

### 14.3 Load Balancing

```

Users → Load Balancer → Multiple Application Servers

```

Benefits: high availability, improved performance, fault tolerance.

---

## 15. DevOps & CI/CD

Continuous Integration and Deployment will automate releases.

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

Benefits: faster deployments, automated testing, reliable releases.

---

## 16. High Level Architecture (Final System)

```

Client
│
HTTPS
│
Load Balancer
│
API Gateway  ←→  RBAC (JWT Role Check)
│
Backend Services
│
┌───────────────┬────────────────┬──────────────────┐│ │ │
SQL Database  Redis Cache      RabbitMQ         webDockets
│                |                |                  |
Financial     Idempotency      Exchanges:           Chat services
Records       Sessions.        chat.messages        agent dashboard
              Agent status     offline.queue
              Rate limits      complaints
                               payments

↓
Pino Logs
↓
Log Aggregation
↓
Monitoring Dashboard
```

---

## 17. Key System Properties

### Property Implementation

| Property         | Implementation                                                     |
| ---------------- | ------------------------------------------------------------------ |
| Security         | HTTPS + JWT + Secure refresh tokens + RBAC role enforcement        |
| Reliability      | Idempotent payments + durable RabbitMQ offline.queue               |
| Consistency      | ACID transactions for all financial data                           |
| Scalability      | Docker + Kubernetes + Load Balancing                               |
| Performance      | Redis caching + async RabbitMQ processing                          |
| Observability    | Pino logging + request correlation + centralized monitoring        |
| Customer Support | WebSocket live chat + complaint ticket system + SSE status updates |
| Access Control   | RBAC — Customer / Support Agent / Admin role separation            |
