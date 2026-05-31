# Auth Service

Handles all authentication and authorisation for the platform — user registration, login, logout, token refresh, password reset, and audit logging.

- **Port:** 3001
- **Database schema:** `auth`
- **Base route:** `/v1/auth`

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

---

## Environment Variables

| Variable                   | Description                             |
| -------------------------- | --------------------------------------- |
| `PORT`                     | Port the service listens on (3001)      |
| `NODE_ENV`                 | development or production               |
| `DB_HOST`                  | PostgreSQL host                         |
| `DB_PORT`                  | PostgreSQL port                         |
| `DB_NAME`                  | Database name                           |
| `DB_USER`                  | Database user                           |
| `DB_PASSWORD`              | Database password                       |
| `JWT_SECRET`               | Secret for signing access tokens        |
| `JWT_EXPIRES_IN`           | Access token lifespan (default 15m)     |
| `REFRESH_TOKEN_SECRET`     | Secret for signing refresh tokens       |
| `REFRESH_TOKEN_EXPIRES_IN` | Refresh token lifespan (default 7d)     |
| `REDIS_URL`                | Redis connection URL                    |

---

## Database

The service uses its own `auth` schema inside the shared PostgreSQL instance. It never queries any other service's schema.

| Table            | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `users`          | User accounts with email, hashed password, and role |
| `refresh_tokens` | Active refresh tokens with revocation support       |
| `audit_logs`     | Immutable record of all authentication events       |

Migrations live in `migrations/` as plain SQL files and are tracked in `auth.migrations`. They run automatically on service startup and never run twice.

---

## Folder Structure

```
auth-service/
├── migrations/
│   ├── 001_create_auth_schema.sql
│   ├── 002_create_users.sql
│   ├── 003_create_refresh_tokens.sql
│   ├── 004_create_triggers.sql
│   └── 005_create_audit_logs.sql
├── src/
│   ├── config/
│   │   └── env.ts
│   └── db/
│       ├── pool.ts
│       └── migrate.ts
├── .env.example
└── README.md
```