# Payment Platform

A secure, scalable payment processing platform that enables users to initiate payments, process transactions securely, track payment status, and receive real-time updates.

---

## Table of Contents

- [Project Status](#project-status)
- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Start the Infrastructure](#start-the-infrastructure)
- [Environment Variables](#environment-variables)
- [Services](#services)
- [Shared Utilities](#shared-utilities)
- [Documentation](#documentation)
- [CI/CD Pipeline](#cicd-pipeline)

---

## Project Status

This project is being built service by service.

The **Auth Service** is currently in progress — JWT authentication, refresh token rotation, Redis token blacklisting, password reset, and audit logging are implemented.

The rest of the platform exists at the design level. Full architecture, database schema, and system flows for every planned service are documented in the [System Design Document](src/v1/docs/architecture/overview.md).

---

## Overview

The platform is built around four core priorities:

- **Security** — JWT authentication, role-based access control, token blacklisting, HTTPS
- **Reliability** — Idempotent transactions, durable message queues, automatic retry logic
- **Scalability** — Independent microservices, each deployable and scalable on its own
- **Real-time** — Server-Sent Events for payment updates, WebSockets for live chat

Each service is independent — its own deployment boundary, PostgreSQL schema, migration history, and documentation.

---

## Architecture

```text
Client Applications
        ↓
    API Gateway
        ↓
┌─────────────────────────────────────────┐
│ Auth │ Payments │ Notifications │ Support │
└─────────────────────────────────────────┘
        ↓
PostgreSQL • Redis • RabbitMQ
```

See the full architecture diagram here: [Architecture Diagram](src/v1/docs/architecture/diagrams/architecture.md)

| Component   | Responsibility                                               |
| ----------- | ------------------------------------------------------------ |
| PostgreSQL  | Financial records, transactions, relational data             |
| Redis       | Caching, rate limiting, idempotency keys, token blacklisting |
| RabbitMQ    | Asynchronous processing, retries, background jobs            |
| API Gateway | Authentication, RBAC, routing, rate limiting                 |
| WebSockets  | Real-time chat communication                                 |
| SSE         | Live payment and complaint updates                           |

---

## Tech Stack

| Category         | Technology           |
| ---------------- | -------------------- |
| Language         | TypeScript           |
| Runtime          | Node.js              |
| Framework        | Express.js           |
| Database         | PostgreSQL           |
| Cache            | Redis                |
| Message Broker   | RabbitMQ             |
| Authentication   | JWT + Refresh Tokens |
| Logging          | Pino                 |
| Containerization | Docker               |
| Orchestration    | Kubernetes (planned) |

---

## Prerequisites

- Node.js 20+
- Docker Desktop

---

## Start the Infrastructure

All services depend on PostgreSQL, Redis, and RabbitMQ. Start them with:

```bash
docker-compose up -d
```

Verify all containers are running:

```bash
docker-compose ps
```

| Service       | Internal Port | Exposed Port | Purpose                             |
| ------------- | ------------- | ------------ | ----------------------------------- |
| PostgreSQL 16 | 5432          | 5433         | Main relational database            |
| Redis 7       | 6379          | 6380         | Caching, rate limiting, idempotency |
| RabbitMQ 3.13 | 5672          | 5672         | Background jobs and message queues  |

RabbitMQ management dashboard available at:

```
http://localhost:15672
```

---

## Environment Variables

The root `.env` is used only by Docker Compose to provision shared infrastructure containers.

Each service manages its own `.env` file for service-specific configuration and secrets.

```
auth-service/.env
payment-service/.env
```

Never commit any `.env` file — all are excluded via `.gitignore`. A `.env.example` file with placeholder values is provided in each service.

---

## Services

| Service              | Port | Status      | Docs                                          |
| -------------------- | ---- | ----------- | --------------------------------------------- |
| API Gateway          | 3000 | Pending     | [gateway.md](src/v1/docs/gateway/overview.md) |
| Auth Service         | 3001 | In Progress | [auth.md](auth-service/docs/auth.md)          |
| Payment Service      | 3002 | Pending     | —                                             |
| Notification Service | 3003 | Pending     | —                                             |
| Support Service      | 3004 | Pending     | —                                             |

---

## Shared Utilities

Shared utilities live in `shared/` and are imported across services using the `@shared/*` TypeScript path alias configured per service.

| File                        | Purpose                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `utils/asyncHandler.ts`     | Wraps async controllers — eliminates repetitive try-catch blocks |
| `utils/errorHandler.ts`     | Centralised AppError class and global error middleware           |
| `utils/logger.ts`           | Pino logger factory for service-specific structured logging      |
| `utils/response.ts`         | Standardised API success and error response helpers              |
| `middleware/rateLimiter.ts` | Redis-backed rate limiter — imported and configured per service  |
| `middleware/requestId.ts`   | Attaches a unique request ID to every incoming request           |

---

## Documentation

All documentation lives in `src/v1/docs/`. Each service has its own `docs/` folder inside the service directory.

### System-Wide Docs

| Document              | Location                                                      |
| --------------------- | ------------------------------------------------------------- |
| Architecture Overview | [overview.md](src/v1/docs/architecture/overview.md)           |
| Services              | [services.md](src/v1/docs/architecture/services.md)           |
| Communication         | [communication.md](src/v1/docs/architecture/communication.md) |
| Request Flow          | [request-flow.md](src/v1/docs/architecture/request-flow.md)   |
| Database              | [database.md](src/v1/docs/infrastructure/database.md)         |
| Redis                 | [redis.md](src/v1/docs/infrastructure/redis.md)               |
| RabbitMQ              | [rabbitmq.md](src/v1/docs/infrastructure/rabbitmq.md)         |
| Docker                | [docker.md](src/v1/docs/infrastructure/docker.md)             |
| Kubernetes            | [kubernetes.md](src/v1/docs/infrastructure/kubernetes.md)     |
| Security              | [security.md](src/v1/docs/security.md)                        |
| Logging               | [logging.md](src/v1/docs/logging.md)                          |
| CI/CD                 | [ci-cd.md](src/v1/docs/ci-cd.md)                              |
| Testing               | [testing.md](src/v1/docs/testing.md)                          |

### Service Docs

| Service      | Document          | Location                                                       |
| ------------ | ----------------- | -------------------------------------------------------------- |
| Auth Service | Service overview  | [auth.md](auth-service/docs/auth.md)                           |
| Auth Service | Sequence diagrams | [sequence-diagrams.md](auth-service/docs/sequence-diagrams.md) |
| API Gateway  | Gateway overview  | [overview.md](src/v1/docs/gateway/overview.md)                 |
| API Gateway  | Routing           | [routing.md](src/v1/docs/gateway/routing.md)                   |

---

## CI/CD Pipeline

```
Developer pushes code
        ↓
GitHub Actions pipeline triggered
        ↓
Linting + TypeScript checks
        ↓
Automated tests run
        ↓
Docker image built
        ↓
Image pushed to container registry
        ↓
Deployment to Kubernetes cluster
```

See [ci-cd.md](src/v1/docs/ci-cd.md) for the full pipeline breakdown.
