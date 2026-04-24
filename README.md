# Payment Platform

A secure, scalable payment processing platform that enables users to initiate payments, process transactions securely, track payment status, and receive real-time updates.

---

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Infrastructure](#infrastructure)
- [Shared Utilities](#shared-utilities)

---

## Overview

The platform is built around four core priorities:

- **Security** — JWT authentication, role-based access control, token blacklisting, HTTPS
- **Reliability** — Idempotent transactions, durable message queues, automatic retry logic
- **Scalability** — Independent microservices, each deployable and scalable on its own
- **Real-time** — Server-Sent Events for payment updates, WebSockets for live chat

Each feature of the platform lives in its own independent service. Services communicate over an internal private network and share a common PostgreSQL database, Redis instance, and RabbitMQ message broker.

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker Desktop

### Start the Infrastructure

The platform depends on three services running via Docker — PostgreSQL, Redis, and RabbitMQ. Start them all with one command:

```bash
docker-compose up -d
```

Verify everything is running:

```bash
docker-compose ps
```

All three containers should show a healthy status.

---

## Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

Never commit your `.env` file — it is already listed in `.gitignore`.

---

## Infrastructure

| Service       | Port | Purpose                                  |
| ------------- | ---- | ---------------------------------------- |
| PostgreSQL 16 | 5432 | Main database for all financial records  |
| Redis 7       | 6379 | Caching, rate limiting, idempotency keys |
| RabbitMQ 3.13 | 5672 | Message queuing and background jobs      |

RabbitMQ management dashboard is available at `http://localhost:15672`

---

## Shared Utilities

Located in `shared/utils/` and imported across all services using the `@shared` path alias configured in each service's `tsconfig.json`.

| File              | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| `asyncHandler.ts` | Wraps controllers — eliminates repetitive try-catch blocks |
| `errorHandler.ts` | AppError class and central error handling middleware       |
| `logger.ts`       | Pino logger configuration                                  |
| `response.ts`     | Standardised success and error response format             |

Usage in any service:

```typescript
import asyncHandler from "@shared/utils/asyncHandler";
import { AppError } from "@shared/utils/errorHandler";
import { sendSuccess } from "@shared/utils/response";
import logger from "@shared/utils/logger";
```
