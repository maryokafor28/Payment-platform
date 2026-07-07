# Docker

## Version

V1

---

## Overview

Every service in the platform runs inside a Docker container. Docker ensures each service runs in a consistent, isolated environment regardless of where it is deployed — development, staging, or production behave identically.

---

## Why Docker

| Requirement             | How Docker Meets It                                              |
| ----------------------- | ---------------------------------------------------------------- |
| Consistent environments | Same container image runs everywhere — no "works on my machine"  |
| Service isolation       | Each service runs in its own container with its own dependencies |
| Portable deployment     | Images built once, run anywhere Docker is installed              |
| Easy local development  | `docker-compose up` starts the entire platform with one command  |
| Reproducible builds     | Dockerfile defines exactly what goes into every image            |

---

## Container Per Service

Each service has its own `Dockerfile` at the root of its directory. Services are never bundled together into a single container.

```
auth/
└── Dockerfile

payment/
└── Dockerfile

support/
└── Dockerfile

notification/
└── Dockerfile

gateway/
└── Dockerfile
```

---

## Internal Networking

All containers run on a private internal Docker network. They communicate with each other using service names as hostnames — no hardcoded IPs.

```
Public Internet
      ↓ HTTPS only
  Load Balancer
      ↓
API Gateway :3000          ← only container exposed to public
      ↓ internal Docker network
  ├── auth-service         :3001
  ├── payment-service      :3002
  ├── notification-service :3003
  └── support-service      :3004
          ↕
  ├── postgres
  ├── redis
  └── rabbitmq
```

**No service other than the API Gateway has a public-facing port.** Internal services are only reachable from within the Docker network.

---

## Shared Infrastructure Containers

PostgreSQL, Redis, and RabbitMQ each run as their own container alongside the services. They are on the same internal network and accessible to all services by hostname.

| Container  | Hostname   | Port |
| ---------- | ---------- | ---- |
| PostgreSQL | `postgres` | 5432 |
| Redis      | `redis`    | 6379 |
| RabbitMQ   | `rabbitmq` | 5672 |

---

## docker-compose (Development)

A `docker-compose.yml` at the root of the monorepo starts the entire platform locally with one command:

```bash
docker-compose up
```

This starts all five services plus PostgreSQL, Redis, and RabbitMQ with the correct network configuration, environment variables, and port mappings.

**What docker-compose handles in development:**

- Starts all containers in the correct order (infrastructure first, services after)
- Mounts source code as volumes for hot reload during development
- Injects environment variables from `.env` files
- Exposes only the API Gateway port to the host machine

---

## Environment Variables

Sensitive configuration is never hardcoded in a `Dockerfile`. All environment-specific values are injected at runtime via environment variables.

Each service reads its config from environment variables at startup:

```
DATABASE_URL=postgresql://user:password@postgres:5432/platform
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://rabbitmq:5672
JWT_SECRET=...
PORT=3001
```

**Rule:** `.env` files are never committed to version control. A `.env.example` file with placeholder values is committed instead so developers know what variables are required.

---

## Production vs Development

| Concern          | Development                    | Production                        |
| ---------------- | ------------------------------ | --------------------------------- |
| Orchestration    | `docker-compose`               | Kubernetes                        |
| Source code      | Mounted as volume (hot reload) | Copied into image at build time   |
| Environment vars | `.env` file                    | Kubernetes secrets                |
| Scaling          | Single instance per service    | Multiple instances via Kubernetes |
| Image registry   | Local                          | Remote registry (built by CI/CD)  |

---

## Further Reading

| Topic                    | Location                                         |
| ------------------------ | ------------------------------------------------ |
| Kubernetes orchestration | [kubernetes.md](../infrastructure/kubernates.md) |
| CI/CD pipeline           | [ci-cd.md](../docs/ci-cd.md)                        |
| Service overview         | [service.md](../architecture/services.md)        |
