# Payment Platform

A secure, scalable payment processing platform that enables users to initiate payments, process transactions securely, track payment status, and receive real-time updates.

> For full architecture, database design, security model, and system flows see the
> [System Design Document](src/docs/payment-platform-system-design-v1.md)

> For a detailed breakdown of the auth service see [auth-service/README.md](services/auth-service/README.md).

> For the full system architecture diagram see [Architecture Diagram](src/images/payment-architecture-diagram.drawio.svg).

---
## 🚧 Project Status

This project is being built in public, service by service.

The **Auth Service** is currently in progress — JWT authentication, refresh token rotation, Redis token blacklisting, password reset, and audit logging are being implemented.

The rest of the platform exists at the design level for now. Full architecture, database schema, and system flows for every planned service are documented in the [System Design Document](#).

## Table of Contents

- [Overview](#overview)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Current Development Focus](#current-development-focus)
- [Prerequisites](#prerequisites)
- [Start the Infrastructure](#start-the-infrastructure)
- [Environment Variables](#environment-variables)
- [Services](#services)
- [Shared Utilities](#shared-utilities)
- [CI/CD Pipeline](#cicd-pipeline)

---

## Overview

The platform is built around four core priorities:

- **Security** — JWT authentication, role-based access control, token blacklisting, HTTPS
- **Reliability** — Idempotent transactions, durable message queues, automatic retry logic
- **Scalability** — Independent microservices, each deployable and scalable on its own
- **Real-time** — Server-Sent Events for payment updates, WebSockets for live chat

Each service is independent — its own deployment boundary, PostgreSQL schema, migration history, and documentation.

---

## Architecture Overview

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

### Core Infrastructure Responsibilities

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

## Current Development Focus

The platform is currently focused on the Auth Service, including:

- JWT authentication
- Refresh token rotation
- Redis token blacklisting
- Password reset flow
- PostgreSQL migrations
- Audit logging
- Role-based access control groundwork
- Structured logging with Pino
- Shared utilities architecture

---

## Prerequisites

- Node.js 20+
- Docker Desktop

---

## Start the Infrastructure

All services depend on PostgreSQL, Redis, and RabbitMQ.

Start the infrastructure containers with:

```bash
docker-compose up -d
```

Verify all containers are running:

```bash
docker-compose ps
```

| Service       | Port | Purpose                             |
| ------------- | ---- | ----------------------------------- |
| PostgreSQL 16 | 5432 | Main relational database            |
| Redis 7       | 6379 | Caching, rate limiting, idempotency |
| RabbitMQ 3.13 | 5672 | Background jobs and message queues  |

RabbitMQ management dashboard:

```text
http://localhost:15672
```

---

## Environment Variables

The root `.env` is used only by Docker Compose to provision shared infrastructure containers.

Each microservice manages its own `.env` file for service-specific configuration and secrets.

Example:

```text
services/auth-service/.env
services/payment-service/.env
```

Never commit any `.env` file — all are excluded via `.gitignore`.

---

## Services

| Service              | Port | Status      | README                                           |
| -------------------- | ---- | ----------- | ------------------------------------------------ |
| API Gateway          | 3000 | Pending     | —                                                |
| Auth Service         | 3001 | In Progress | [auth-service/README.md](auth-service/README.md) |
| Payment Service      | 3002 | Pending     | —                                                |
| Notification Service | 3003 | Pending     | —                                                |
| Support Service      | 3004 | Pending     | —                                                |

---

## Shared Utilities

Shared utilities live inside `shared/utils/` and are imported across services using the `@shared/*` TypeScript path alias configured per service.

| File              | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `asyncHandler.ts` | Wraps async controllers and eliminates repetitive try-catch blocks |
| `errorHandler.ts` | Centralized AppError class and error middleware                    |
| `logger.ts`       | Pino logger factory for service-specific structured logging        |
| `response.ts`     | Standardized API success and error response helpers                |

Example usage:

```typescript
import asyncHandler from "@shared/utils/asyncHandler";
import { AppError } from "@shared/utils/errorHandler";
import { sendSuccess } from "@shared/utils/response";
import { createLogger } from "@shared/utils/logger";

const logger = createLogger("auth-service");
```

## CI/CD Pipeline

The platform is designed with automated CI/CD pipelines to ensure reliable builds, testing, and deployments across services.

### Planned Pipeline Flow

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

### CI/CD Goals

- Automated testing
- Consistent deployments
- Reduced deployment risk
- Reproducible Docker builds
- Service-level deployment independence
