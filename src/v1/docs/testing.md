# Testing

## Version

V1

---

## Overview

Every service in the platform has its own test suite. Tests are a required part of the CI/CD pipeline — a failing test always blocks deployment. This document covers the testing strategy, types, and standards that apply across all services.

Service-specific test cases are documented inside each service's own docs folder.

---

## Testing Strategy

The platform uses a three-layer testing approach:

```
        ┌─────────────────────┐
        │    End-to-End (E2E)  │  ← least, slowest, most realistic
        ├─────────────────────┤
        │   Integration Tests  │  ← middle ground
        ├─────────────────────┤
        │     Unit Tests       │  ← most, fastest, most isolated
        └─────────────────────┘
```

---

## Unit Tests

Unit tests verify individual functions and handlers in isolation. External dependencies — database, Redis, RabbitMQ — are mocked. They run fast and catch logic errors early.

**What gets unit tested:**

- Input validation logic
- Business rule functions (balance checks, role checks, idempotency logic)
- JWT generation and verification
- Password hashing and comparison
- Rate limiter middleware logic
- Error handler responses

**Example — Auth Service unit test:**

```typescript
describe("validateEmail", () => {
  it("rejects email without @ symbol", () => {
    expect(validateEmail("notanemail")).toBe(false);
  });

  it("rejects email longer than 150 characters", () => {
    expect(validateEmail("a".repeat(140) + "@test.com")).toBe(false);
  });

  it("accepts a valid lowercase email", () => {
    expect(validateEmail("user@example.com")).toBe(true);
  });
});
```

---

## Integration Tests

Integration tests verify that a service works correctly with its real dependencies — a real PostgreSQL database, real Redis, and real RabbitMQ running in Docker. They test the full request path from HTTP request to database write and back.

**What gets integration tested:**

- Auth endpoints — register, login, logout, token refresh, password reset
- Payment endpoints — send, receive, balance, history
- Support endpoints — start chat, send message, lodge complaint, update status
- Notification SSE — event published → SSE received by client
- Middleware — rate limiting, JWT validation, RBAC enforcement

**Test database:**

Each integration test run uses a dedicated test database schema that is seeded before tests and wiped after. Tests never run against the development or production database.

```
Before each test suite:
  → Run migrations against test schema
  → Seed required test data

After each test suite:
  → Truncate all test tables
  → Clear Redis test keys
```

**Example — Payment Service integration test:**

```typescript
describe("POST /v1/payments/send", () => {
  it("returns 200 and debits sender on valid request", async () => {
    const res = await request(app)
      .post("/v1/payments/send")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", "unique-key-123")
      .send({ receiverId: "uuid", amount: 1000, currency: "NGN" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
  });

  it("returns 200 with same result on duplicate idempotency key", async () => {
    // second request with same key should not process again
    const res = await request(app)
      .post("/v1/payments/send")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", "unique-key-123")
      .send({ receiverId: "uuid", amount: 1000, currency: "NGN" });

    expect(res.status).toBe(200);
    // balance unchanged — duplicate blocked
  });

  it("returns 429 when rate limit exceeded", async () => {
    // send 21 requests — limit is 20 per minute
  });
});
```

---

## End-to-End Tests (E2E)

E2E tests simulate real user journeys across the full platform. They run against a fully deployed environment with all services running. They are slower and run less frequently — typically before a production release.

**What gets E2E tested:**

- Full payment flow — login → send payment → receive SSE update
- Full chat flow — start chat → AI response → escalate → agent response
- Full complaint flow — lodge complaint → agent updates → SSE received
- Full auth flow — register → login → logout → token blacklisted

---

## Test Tools

| Tool      | Purpose                                                |
| --------- | ------------------------------------------------------ |
| Jest      | Test runner and assertion library across all services  |
| Supertest | HTTP integration testing for Express endpoints         |
| Docker    | Runs PostgreSQL, Redis, RabbitMQ for integration tests |
| ts-jest   | TypeScript support in Jest                             |

---

## Test File Structure

Each service follows the same test file structure:

```
auth/
└── src/
    ├── handlers/
    │   ├── login.ts
    │   └── login.test.ts        ← unit test sits next to the file it tests
    ├── middleware/
    │   ├── rateLimiter.ts
    │   └── rateLimiter.test.ts
    └── __tests__/
        └── integration/
            └── auth.test.ts     ← integration tests in dedicated folder
```

---

## CI/CD Integration

Tests run automatically on every push. The pipeline runs unit tests first — they are fast. Integration tests run after. E2E tests run only on merges to `staging` and `main`.

```
Push to any branch
      ↓
Unit tests → fail → pipeline stops, nothing deployed
      ↓
Integration tests → fail → pipeline stops, nothing deployed
      ↓
Merge to staging / main only:
E2E tests → fail → pipeline stops, nothing deployed
      ↓
All pass → build image → deploy
```

---

## Coverage Standards

| Service         | Minimum Coverage Target |
| --------------- | ----------------------- |
| Auth Service    | 80%                     |
| Payment Service | 80%                     |
| Support Service | 70%                     |
| Notification    | 70%                     |
| API Gateway     | 80%                     |

Coverage is checked in CI. A build that drops below the minimum coverage threshold fails.

---

## Further Reading

| Topic                      | Location                                                         |
| -------------------------- | ---------------------------------------------------------------- |
| Auth Service test cases    | [auth.md](../../../../services/auth-service/docs/auth.md)        |
| Payment Service test cases | [payment.md](../../../auth-service/docs/auth.md)                 |
| Support Service test cases | [support.md](../../../support-service/docs/support.md)           |
| Notification test cases    | [notification.md](../../../notification-service/docs/support.md) |
| CI/CD pipeline             | [ci-cd.md](../docs/ci-cd.md)                                     |
