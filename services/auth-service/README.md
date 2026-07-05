# Auth Service

Handles all authentication and authorisation for the platform — user registration, login, logout, token refresh, password reset, and audit logging.

- **Port:** `3001`
- **Database schema:** `auth`
- **Base route:** `/v1/auth`

> For full service documentation — endpoints, JWT design, middleware, password reset flow, and audit logging see [docs/auth.md](docs/auth.md)

> For all request and response flows see [docs/sequence-diagrams.md](docs/sequence-diagrams.md)

---

## Table of Contents

- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Folder Structure](#folder-structure)

---

## Getting Started

Install dependencies:

```bash
cd auth-service
npm install
```

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Generate secure JWT secrets by running this command twice — once for `JWT_SECRET`, once for `REFRESH_TOKEN_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Start the infrastructure (PostgreSQL, Redis, RabbitMQ) from the root of the monorepo:

```bash
docker-compose up -d
```

Run the service:

```bash
npm run dev
```

---

## Environment Variables

| Variable                   | Description                           |
| -------------------------- | ------------------------------------- |
| `PORT`                     | Port the service listens on — `3001`  |
| `NODE_ENV`                 | `development` or `production`         |
| `DB_HOST`                  | PostgreSQL host                       |
| `DB_PORT`                  | PostgreSQL port                       |
| `DB_NAME`                  | Database name                         |
| `DB_USER`                  | Database user                         |
| `DB_PASSWORD`              | Database password                     |
| `JWT_SECRET`               | Secret for signing access tokens      |
| `JWT_EXPIRES_IN`           | Access token lifespan e.g. `15m`      |
| `REFRESH_TOKEN_SECRET`     | Secret for signing refresh tokens     |
| `REFRESH_TOKEN_EXPIRES_IN` | Refresh token lifespan e.g. `7d`      |
| `REDIS_URL`                | Redis connection URL                  |
| `LOG_LEVEL`                | Pino log level — `info` in production |

---

## Database

The service owns the `auth` schema inside the shared PostgreSQL instance. It never queries any other service's schema.

| Table            | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `users`          | User accounts — email, hashed password, role   |
| `refresh_tokens` | Active refresh tokens with revocation support  |
| `audit_logs`     | Immutable write-only record of all auth events |

Migrations live in `database/migrations/` as plain SQL files and are tracked in `auth.migrations`. They run automatically on service startup and never run twice.

---

## Folder Structure

```
auth-service/
├── database/
│   ├── migrations/
│   │   ├── 001_create_users.sql
│   │   ├── 002_create_trigger.sql
│   │   ├── 003_create_refresh_tokens.sql
│   │   └── 004_create_audit_logs.sql
│   └── run-migrations.ts
├── docs/
│   ├── auth.md
│   └── sequence-diagrams.md
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   ├── logger.ts
│   │   └── redis.ts
│   ├── controllers/
│   │   └── auth.controller.ts
│   ├── middleware/
│   │   ├── authenticate.ts
│   │   ├── rateLimiter.ts
│   │   └── validate.ts
│   ├── routes/
│   │   └── auth.routes.ts
│   ├── services/
│   │   ├── audit.service.ts
│   │   ├── auth.service.ts
│   │   └── token.service.ts
│   ├── types/
│   │   └── auth.types.ts
│   ├── utils/
│   │   ├── hash.ts
│   │   └── jwt.ts
│   ├── validator/
│   │   └── auth.validator.ts
│   ├── app.ts
│   └── server.ts
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```
