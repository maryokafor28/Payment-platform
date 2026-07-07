# Architecture Overview

## Version

V1

---

## What This System Does

This is a secure, scalable payment processing platform. It enables users to:

- Initiate and receive payments
- Track transaction status in real time
- Get live updates via SSE
- Contact support via AI-assisted or live agent chat
- Lodge and track complaints

The platform serves three types of users: **customers**, **support agents**, and **admins**. Each has a defined role with strict access control enforced at every layer.

---

## Why Microservices

The platform is built using a microservices architecture. Instead of one large application handling everything, the system is split into small, independent services that each do one job.

A monolith puts everything in one program:

```
MONOLITH
┌──────────────────────────────────────────┐
│  Auth + Payments + Support + Notifications│
│  — all one program                        │
└──────────────────────────────────────────┘
```

Problem: if Support crashes, the entire platform goes down.

Microservices splits that into independent programs:

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│   Auth   │  │ Payments │  │ Support  │  │Notif'n   │  │ Gateway  │
│ Service  │  │ Service  │  │ Service  │  │ Service  │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

If Support crashes, only support is affected. Payments and auth keep running.

---

## Services

| Service              | Port | Responsibility                                                                 |
|----------------------|------|--------------------------------------------------------------------------------|
| API Gateway          | 3000 | Single entry point — JWT validation, RBAC, rate limiting, routing, logging     |
| Auth Service         | 3001 | Registration, login, JWT issuance, logout, token blacklisting, password reset  |
| Payment Service      | 3002 | Send, receive, balance check, transaction history, idempotency                 |
| Notification Service | 3003 | SSE updates — payment status, complaint updates, agent alerts                  |
| Support Service      | 3004 | WebSocket chat, AI routing, live agent escalation, complaints, agent management|


---

## How the System Is Structured

All services run inside Docker containers on an internal private network. Only the API Gateway has a public-facing address. No service is directly reachable from the outside world.

```
Public Internet
      ↓ HTTPS only
  Load Balancer
      ↓
API Gateway :3000        (only public-facing service)
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

## Shared Infrastructure

All services share three infrastructure components:

| Component  | Purpose                                                                 |
|------------|-------------------------------------------------------------------------|
| PostgreSQL | All relational data — users, transactions, support history              |
| Redis      | Idempotency keys, token blacklist, rate limiting, agent availability    |
| RabbitMQ   | Async processing — payments, chat routing, notifications, complaints    |

Each service owns its own PostgreSQL schema. Services never query another service's tables directly.

---

## Key System Properties

| Property       | Implementation                                                              |
|----------------|-----------------------------------------------------------------------------|
| Security       | HTTPS + JWT + secure refresh tokens + RBAC enforcement at the gateway       |
| Reliability    | Idempotent payments + durable RabbitMQ queues + Dead Letter Queue           |
| Consistency    | ACID transactions for all financial operations                              |
| Scalability    | Docker + Kubernetes + independent per-service scaling                       |
| Performance    | Redis caching + async RabbitMQ processing                                   |
| Observability  | Pino structured logging + request correlation IDs + centralised monitoring  |
| Access Control | RBAC — Customer / Support Agent / Admin role separation                     |

---

## Further Reading

| Topic                        | Location                                                        |
|------------------------------|-----------------------------------------------------------------|
| How services communicate     | [communication.md](../architecture/communication.md)            |
| End-to-end request flow      | [request-flow.md](../architecture/request-flow.md)              |
| All services and ports       | [services.md](../architecture/services.md)                      |
| Architecture diagram         | [architecture.png](../architecture/diagrams/architecture.md)   |
| Database design              | [database.md](../infrastructure/database.md)                    |
| Redis usage                  | [redis.md](../infrastructure/redis.md)                          |
| RabbitMQ queues              | [rabbitmq.md](../infrastructure/rabbitmq.md)                    |
| Auth Service                 | [auth.md](../../../../services/auth-service/docs/auth.md)                 |
| Payment Service              | [payment.md](../../../payment-service/docs/payment.md)          |
| Support Service              | [support.md](../../../support-service/docs/support.md)          |
| Notification Service         | [notification.md](../../../notification-service/docs/notification.md) |
| API Gateway                  | [gateway.md](../gateway/overview.md)                            |