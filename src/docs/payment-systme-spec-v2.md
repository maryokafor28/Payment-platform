## PAYMENT PLATFORM

### TECHNICAL SPECIFICATION

API Version 2.0 — New Features Only
This document covers only features introduced in v2.
For the full platform foundation, refer to: payment_platform_spec_v1.docx

---

## Version History

| Version | Date       | Description                                                                                                                               |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0    | March 2026 | Foundation — database, auth, RBAC, payments, Redis, RabbitMQ, live chat, complaints, logging, Docker, Kubernetes                          |
| v2.0    | -          | New features — API versioning, webhooks, audit logs, fraud detection, reconciliation, payment lifecycle, retry + DLQ, monitoring & alerts |

## About This Document

This is Version 2 of the Payment Platform Technical Specification. It documents only the new features introduced in this version. Everything from Version 1 — including the database layer, authentication, RBAC, Redis, RabbitMQ, live chat, complaints, logging, Docker, and Kubernetes — remains unchanged and is fully documented in the v1 specification.

### New in v2:

- API versioning — all endpoints now prefixed with /v2/
- Webhooks — notify external merchants when payment events occur
- Audit logs — permanent tamper-proof record of every sensitive action
- Fraud detection — real-time risk scoring on every payment
- Reconciliation — daily comparison against payment processor records
- Payment lifecycle — defined states from initiation to settlement
- Monitoring & Alerts — Prometheus + Grafana with automated alerting

---

## 1. API Versioning

The platform now uses URL-based API versioning. Every endpoint is prefixed with a version number so new releases never break existing integrations.

### 1.1 URL Structure

v1 (stable, maintained): api.payment.com/v1/payments/send

v2 (this release): api.payment.com/v2/payments/send

### 1.2 Why This Matters

Without versioning, any breaking change would immediately break every merchant or third-party system already integrated with the platform. With versioning:

- v1 stays alive — existing integrations continue working without changes
- v2 launches — new merchants integrate with the updated version
- Deprecation notice issued — v1 announced for shutdown 6 months ahead
- v1 retired cleanly — after migration window closes

  ### 1.3 When to Create a New Version

- A field is renamed or removed from a request or response
- An endpoint URL changes
- A response structure changes in a breaking way
- Non-breaking additions (new optional fields) do NOT require a new version

---

## 2. New Database Tables in v2

The following tables are added to the existing database. No existing v1 tables are modified.

| Table                  | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| webhooks               | Registered webhook URLs per merchant with their HMAC secret signing key         |
| webhook_logs           | Delivery history for every webhook attempt — status, retry count, response code |
| audit_logs             | Permanent write-only record of every sensitive action across the platform       |
| fraud_events           | Flagged transactions and suspicious activity with risk score and outcome        |
| reconciliation_reports | Daily mismatch reports between internal DB and payment processor records        |

## 3. Payment Lifecycle

Every payment now moves through a formally defined set of states. Each state change is recorded in the database, written to the audit log, and pushed to the customer via SSE.

| State      | Meaning                                             |
| ---------- | --------------------------------------------------- |
| INITIATED  | Request received, idempotency key checked in Redis  |
| VALIDATING | Balance check and fraud risk scoring in progress    |
| PROCESSING | Sent to payment processor — awaiting response       |
| SUCCESS    | Processor confirmed payment completed               |
| FAILED     | Processor rejected or a system error occurred       |
| SETTLED    | Daily reconciliation confirmed match — fully closed |
| REFUNDED   | Reversal processed and confirmed by processor       |

### 3.1 Full Lifecycle Flow

INITIATED

```
  User clicks Pay → POST /v2/payments/send
  Idempotency key checked (Redis)
  ↓
VALIDATING
  Account balance verified
  Fraud Detection Service evaluates risk score
  ↓
PROCESSING
  Published to RabbitMQ payment queue
  Payment processor called (Paystack / Flutterwave)
  ↓
SUCCESS  or  FAILED
  Database updated with final status
  Webhook fired to merchant
  SSE update pushed to customer in real time
  Audit log entry written
  ↓
SETTLED
  Daily reconciliation confirms match with processor
  ↓
REFUNDED (if applicable)
  Reversal processed
  Audit log updated
  Webhook fired: payment.refunded
```

---

## 3.2. Audit Logs

Audit logs are a permanent, tamper-proof record of every sensitive action across the platform. Unlike application logs which track system performance, audit logs track who did what, when, from where, and what changed.

Critical rule: Audit logs are write-only. No UPDATE, no DELETE — ever. Not even by admins. They are a permanent legal and operational record.

### 3.3 What Gets Logged

Authentication events:

- Login, logout, failed login, password changed, token refreshed

Payment events:

- Payment initiated, approved, failed, refunded, duplicate blocked by idempotency

Admin and agent actions:

- Complaint status updated, agent assigned, user role changed, webhook registered or deleted

Security events:

- Rate limit exceeded, multiple failed logins, 403 unauthorized access attempt, fraud flag triggered

### 3.4 Audit Log Table Structure

| Field          | Type      | Description                                         |
| -------------- | --------- | --------------------------------------------------- |
| audit_id       | UUID      | Unique record identifier                            |
| user_id        | UUID      | Who performed the action                            |
| role           | ENUM      | Their role at the time: customer, agent, admin      |
| action         | VARCHAR   | e.g. payment.initiated, complaint.status.updated    |
| entity         | VARCHAR   | The affected resource: payments, complaints, users  |
| entity_id      | UUID      | The specific record that was affected               |
| previous_value | JSONB     | State of the record before the action               |
| new_value      | JSONB     | State of the record after the action                |
| ip_address     | VARCHAR   | IP address the request came from                    |
| user_agent     | VARCHAR   | Browser or device information                       |
| request_id     | UUID      | Links to Pino application log for full trace        |
| created_at     | TIMESTAMP | When the action occurred — immutable, never updated |

### 3.5 Example Audit Log Entry

```
{
  "auditId":       "uuid",
  "timestamp":     "2026-03-19T10:00:00Z",
  "userId":        "uuid",
  "role":          "agent",
  "action":        "complaint.status.updated",
  "entity":        "complaints",
  "entityId":      "uuid",
  "previousValue": { "status": "open" },
  "newValue":      { "status": "resolved" },
  "ipAddress":     "102.89.1.1",
  "requestId":     "req_uuid"
}
```

---

## 4. Fraud Detection

The Fraud Detection Service evaluates every payment in real time before processing. It checks a set of rules against Redis data and assigns a risk score. The outcome determines whether the payment is allowed, flagged, or blocked.

### 4.1 Risk Scoring

| Score  | Action                                                   |
| ------ | -------------------------------------------------------- |
| Low    | Process payment normally                                 |
| Medium | Process but flag in fraud_events table and notify admin  |
| High   | Block payment, notify user and admin, write to audit log |

### 4.2 Fraud Rules

| Rule                      | Condition                                                | Action                                        |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| Velocity check            | 5+ payments from same user in under 2 minutes            | Flag as suspicious, require re-authentication |
| Amount anomaly            | Transaction is 10x the user's historical average         | Flag for manual admin review                  |
| Location anomaly          | Login from a new country within 10 minutes of last login | Block — impossible travel, alert user         |
| Failed attempts           | 3+ consecutive failed payment attempts                   | Temporarily lock payment ability              |
| New device + large amount | First login from this device AND amount above threshold  | Require additional verification               |

### 4.3 Fraud Detection Flow

Payment request arrives

↓ Fraud Detection Service checks all rules against Redis
(velocity counters, device fingerprint, location history)

↓ Risk score calculated: Low / Medium / High

↓ Low → process payment normally

↓ Medium → process + flag in fraud_events + notify admin

↓ High → block + notify user + write to audit log

---

## 5. Webhooks

Webhooks allow the platform to notify external merchant systems the moment a payment event occurs. Instead of the merchant calling your API repeatedly to check if a payment completed, your system tells them automatically.

### 5.1 What a Webhook Is

When a payment succeeds, fails, or is refunded, the platform sends an HTTP POST to the merchant's registered URL with the event details. The merchant's server receives it and acts — for example marking an order as paid or releasing a digital product.

### 5.2 Webhook Delivery Flow

Payment event occurs (success / failed / refunded)
↓ Platform checks: does this merchant have a webhook URL registered?
↓ Yes → publishes event to RabbitMQ webhook.delivery queue
↓ Webhook Service sends HTTP POST to merchant URL:

```json
{
  "event": "payment.success",
  "paymentId": "uuid",
  "amount": 5000,
  "currency": "NGN",
  "timestamp": "2026-03-19T10:00:00Z"
}
```

↓ Merchant server responds with 200 OK
↓ Delivery logged in webhook_logs as: success

### 5.3 Webhook Security — HMAC Signature

Every webhook is signed so merchants can verify it genuinely came from the platform and not a malicious third party.

```
Platform generates a unique secret key per merchant at

↓ On every webhook, platform signs the payload:
HMAC-SHA256(payload, merchant_secret) = signature
↓ Signature sent in request header:
X-Webhook-Signature: sha256=abc123xyz
↓ Merchant recomputes signature using their secret key
↓ Signatures match → request is legitimate ✓
↓ Signatures differ → reject — possible attack ✗
```

Note: Webhook retry logic and the Dead Letter Queue are handled by the same RabbitMQ retry mechanism documented in v1 Section 8.6. The same exponential backoff and DLQ pattern applies to webhook delivery.

### 5.4 Retry Logic and Dead Letter Queue

Webhook delivery fails — no 200 OK received

```
↓ RabbitMQ retries with exponential backoff:
- Attempt 1 → wait 30 seconds → retry
- Attempt 2 → wait 1 minute → retry
- Attempt 3 → wait 5 minutes → retry
- Attempt 4 → wait 30 minutes → retry
↓ All retries exhausted
↓ Message moved to Dead Letter Queue (DLQ)
↓ Admin dashboard alert: webhook failed after 4 retries
↓ Admin inspects → fixes issue → manually replays from DLQ
```

### 5.5 Webhook Events

| Event              | Trigger                                          |
| ------------------ | ------------------------------------------------ |
| payment.success    | Payment completed successfully                   |
| payment.failed     | Payment was rejected or a system error occurred  |
| payment.refunded   | Payment was reversed and refunded                |
| complaint.resolved | A complaint linked to a transaction was resolved |

---

## 6. Reconciliation System

Reconciliation is an automated daily job that compares the platform's internal transaction records against the payment processor's records to detect any mismatches before they become problems.

### 6.1 Why It Is Necessary

- A customer was charged but the platform recorded the payment as failed
- A payment succeeded on the processor but the database was not updated
- A duplicate charge occurred despite idempotency protection
- Without reconciliation these discrepancies go undetected indefinitely

### 6.2 Reconciliation Flow

Scheduled job runs daily at 2:00 AM

↓ Fetch all transactions from platform DB for that day

↓ Fetch all transactions from payment processor API

↓ Compare every record:

- Amount matches? ✓ or ✗
- Status matches? ✓ or ✗
- Timestamp matches? ✓ or ✗

  ↓ Mismatches saved to reconciliation_reports table

  ↓ Admin receives dashboard alert: 3 mismatches found

  ↓ Admin investigates and resolves each one

  ### 6.3 Mismatch Types

| Type                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| Amount mismatch     | Platform recorded a different amount from what the processor shows |
| Status mismatch     | Platform shows success but processor shows failed, or vice versa   |
| Missing transaction | Exists in processor records but not found in the platform database |
| Duplicate charge    | Same payment appears twice on the processor statement              |

## 7. New API Endpoints in v2

The following endpoints are new in v2. All existing v1 endpoints continue to work unchanged at their /v1/ prefix. The v2 versions of existing endpoints behave identically unless noted.

### Webhooks:

| Endpoint                | Method | Role  | Description                         |
| ----------------------- | ------ | ----- | ----------------------------------- |
| /v2/webhooks/register   | POST   | Admin | Register a merchant webhook URL     |
| /v2/webhooks/list       | GET    | Admin | List all registered webhooks        |
| /v2/webhooks/delete/:id | DELETE | Admin | Remove a webhook                    |
| /v2/webhooks/logs/:id   | GET    | Admin | View delivery history for a webhook |
| /v2/webhooks/retry/:id  | POST   | Admin | Manually retry a failed webhook     |

### Audit Logs:

| Endpoint                   | Method | Role  | Description                              |
| -------------------------- | ------ | ----- | ---------------------------------------- |
| /v2/audit/logs             | GET    | Admin | View all audit logs with filters         |
| /v2/audit/logs/:userId     | GET    | Admin | All actions performed by a specific user |
| /v2/audit/logs/:entity/:id | GET    | Admin | Full history of a specific record        |

### Reconciliation:

| Endpoint                       | Method | Role  | Description                               |
| ------------------------------ | ------ | ----- | ----------------------------------------- |
| /v2/reconciliation/run         | POST   | Admin | Manually trigger a reconciliation run     |
| /v2/reconciliation/reports     | GET    | Admin | View all reconciliation reports           |
| /v2/reconciliation/reports/:id | GET    | Admin | View a specific report and its mismatches |

---

## 8. Monitoring & Alerts

Prometheus collects platform metrics every 15 seconds by scraping a dedicated /metrics endpoint. Grafana reads from Prometheus, displays real-time dashboards, and fires alerts automatically when thresholds are crossed.

### 8.1 How It Works

Platform exposes health data at: GET /metrics
↓ Prometheus scrapes /metrics every 15 seconds

↓ Stores metrics: payment success rate, API latency,
error rate, queue depth, active sessions, DLQ count
↓ Grafana reads from Prometheus continuously

↓ Admin sees real-time dashboard

↓ Metric crosses threshold → Grafana fires alert

↓ Notification sent: Email / Slack / SMS

### 8.2 Alert Thresholds

| Metric                | Normal         | Alert Fires When                |
| --------------------- | -------------- | ------------------------------- |
| Payment failure rate  | < 1%           | > 5% in any 5-minute window     |
| API response time     | < 200ms        | > 2 seconds average             |
| System error rate     | < 0.5%         | > 3% in 2 minutes               |
| RabbitMQ queue depth  | < 100 messages | > 1,000 messages backed up      |
| Dead Letter Queue     | 0 messages     | Any message enters DLQ          |
| Failed login attempts | Normal traffic | 20+ failed attempts in 1 minute |
| Webhook failure rate  | < 1%           | > 10% in 10 minutes             |

### 8.3 Alert Notification Channels

- Email — engineering team receives all alerts
- Slack — #alerts channel receives warning and error level alerts
- SMS — on-call engineer receives critical alerts (payment system down, DLQ spike)

## 8.4. Updated Architecture Additions (v2)

    The following components are new in v2 and sit alongside the existing v1 architecture. The full architecture diagram including v1 components is in the v1 specification.

```
- ├── Fraud Detection Service
  │ Evaluates every payment before processing
  │ Reads velocity counters and device data from Redis
  │
  ├── Webhook Service
  │ Fires HTTP POST to merchant URLs on payment events
  │ Uses same RabbitMQ retry + DLQ pattern from v1
  │
  ├── Reconciliation Service
  │ Runs daily at 2:00 AM
  │ Compares DB records against payment processor API
  │
  ├── Audit Log Writer
  │ Writes to audit_logs table on every sensitive action
  │ Write-only — no updates or deletes permitted
  │
  └── Monitoring Stack
  Prometheus → scrapes /metrics every 15 seconds
  Grafana → dashboards + automated alerts
  Channels → Email / Slack / SMS
```

## 9. New System Properties Added in v2

| Property         | Implementation                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------ |
| API Stability    | URL versioning — v1 and v2 run independently, no breaking changes to existing integrations |
| Auditability     | Write-only audit logs on every sensitive action — permanent, tamper-proof                  |
| Fraud Prevention | Real-time risk scoring on every payment using velocity, anomaly, and device rules          |
| Merchant Support | Webhooks with HMAC signing, exponential retry, and Dead Letter Queue                       |
| Data Integrity   | Daily automated reconciliation against payment processor records                           |
| Observability    | Prometheus metrics + Grafana dashboards + automated multi-channel alerts                   |
