# Payment Platform

A secure, scalable payment processing platform that enables users to initiate payments, process transactions securely, track payment status, and receive real-time updates.

> For full architecture, database design, security model, and system flows see the  
> [System Design Document](src/docs/payment-platform-system-design-v1.md)

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Start the Infrastructure](#start-the-infrastructure)
- [Environment Variables](#environment-variables)
- [Services](#services)
- [Shared Utilities](#shared-utilities)

---

## Overview

The platform is built around four core priorities:

- **Security** — JWT authentication, role-based access control, token blacklisting, HTTPS
- **Reliability** — Idempotent transactions, durable message queues, automatic retry logic
- **Scalability** — Independent microservices, each deployable and scalable on its own
- **Real-time** — Server-Sent Events for payment updates, WebSockets for live chat

Each service is independent — its own codebase, its own database schema, its own documentation.

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

Verify everything is running:

```bash
docker-compose ps
```

| Service       | Port | Purpose                                  |
| ------------- | ---- | ---------------------------------------- |
| PostgreSQL 16 | 5432 | Main database for all financial records  |
| Redis 7       | 6379 | Caching, rate limiting, idempotency keys |
| RabbitMQ 3.13 | 5672 | Message queuing and background jobs      |

RabbitMQ management dashboard — `http://localhost:15672`

---

## Environment Variables

The root `.env` is used by Docker Compose only to spin up the infrastructure containers. Each service manages its own `.env` — see the README inside each service folder for the variables it requires.

Never commit any `.env` file — all are listed in `.gitignore`.

---

## Services

| Service              | Port | Status      | README                                           |
| -------------------- | ---- | ----------- | ------------------------------------------------ |
| API Gateway          | 3000 | Pending     | —                                                |
| Auth Service         | 3001 | In progress | [auth-service/README.md](auth-service/README.md) |
| Payment Service      | 3002 | Pending     | —                                                |
| Notification Service | 3003 | Pending     | —                                                |
| Support Service      | 3004 | Pending     | —                                                |

---

## Shared Utilities

Located in `shared/utils/` and imported across all services via the `@shared` path alias configured in each service's `tsconfig.json`.

| File              | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| `asyncHandler.ts` | Wraps controllers — eliminates try-catch boilerplate        |
| `errorHandler.ts` | AppError class and central error handling middleware        |
| `logger.ts`       | Pino logger factory — each service creates a named instance |
| `response.ts`     | Standardised success and error response format              |

```typescript
import asyncHandler from "@shared/utils/asyncHandler";
import { AppError } from "@shared/utils/errorHandler";
import { sendSuccess } from "@shared/utils/response";
import { createLogger } from "@shared/utils/logger";

const logger = createLogger("auth-service");
```
