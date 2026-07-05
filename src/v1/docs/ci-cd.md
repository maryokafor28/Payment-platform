# CI/CD Pipeline

## Version

V1

---

## Overview

The platform uses a continuous integration and continuous deployment pipeline. Every code change pushed to the repository automatically runs tests, builds a Docker image, and deploys to Kubernetes. No manual deployment steps are required.

---

## Pipeline Stages

```
Developer pushes code
      ↓
1. Automated tests run
      ↓
2. Docker image built
      ↓
3. Image pushed to container registry
      ↓
4. Kubernetes pulls new image
      ↓
5. Rolling update — zero downtime deployment
```

---

## Stage 1 — Automated Tests

The first thing the pipeline does is run the test suite. If any test fails, the pipeline stops — no image is built, nothing is deployed.

**What runs:**

| Test Type         | Purpose                                                    |
| ----------------- | ---------------------------------------------------------- |
| Unit tests        | Individual functions and handlers tested in isolation      |
| Integration tests | Service endpoints tested against a real database and Redis |
| Linting           | Code style and TypeScript type checks enforced             |

**Rule:** A failing test always blocks deployment. No exceptions.

---

## Stage 2 — Docker Image Build

If all tests pass, the pipeline builds a Docker image for the affected service. Each service has its own `Dockerfile` that defines exactly what goes into the image.

```bash
docker build -t payment-service:$GIT_SHA ./payment
```

Images are tagged with the Git commit SHA — every deployed image is traceable back to the exact commit that produced it.

---

## Stage 3 — Push to Container Registry

The built image is pushed to a container registry. Kubernetes pulls images from this registry during deployment.

```bash
docker push registry.example.com/payment-service:$GIT_SHA
```

Old images are retained in the registry for rollback purposes.

---

## Stage 4 — Deploy to Kubernetes

The pipeline instructs Kubernetes to update the deployment with the new image:

```bash
kubectl set image deployment/payment-service \
  payment-service=registry.example.com/payment-service:$GIT_SHA
```

Kubernetes begins a rolling update — replacing old pods with new ones gradually.

---

## Stage 5 — Rolling Update

Kubernetes replaces pods one at a time. Traffic is always routed to healthy pods — there is no downtime window.

```
New pod starts
      ↓
Readiness probe passes
      ↓
Traffic routed to new pod
      ↓
Old pod terminated
      ↓
Repeat until all pods are updated
```

If the new pod fails its readiness probe, the rollout stops automatically and the old pods continue serving traffic. No broken version is ever fully deployed.

---

## Per-Service Pipelines

Each service has its own independent pipeline. Pushing a change to the Auth Service only triggers the Auth Service pipeline — Payment, Support, and Notification are unaffected.

| Service              | Triggered By                              |
| -------------------- | ----------------------------------------- |
| Auth Service         | Changes in `auth/`                        |
| Payment Service      | Changes in `payment/`                     |
| Support Service      | Changes in `support/`                     |
| Notification Service | Changes in `notification/`                |
| API Gateway          | Changes in `gateway/`                     |
| Shared               | Changes in `shared/` trigger all services |

---

## Branch Strategy

| Branch           | Purpose                             | Auto-deploys To |
| ---------------- | ----------------------------------- | --------------- |
| `main`           | Production-ready code               | Production      |
| `staging`        | Pre-production testing              | Staging         |
| `dev`            | Active development                  | Development     |
| Feature branches | Individual features — merged via PR | Nothing         |

**Rule:** No direct pushes to `main`. All changes go through a pull request with at least one review before merging.

---

## Rollback

Every deployment is tagged with the Git commit SHA. If a deployment causes issues in production, rollback is a single command:

```bash
kubectl set image deployment/payment-service \
  payment-service=registry.example.com/payment-service:$PREVIOUS_SHA
```

Kubernetes immediately begins rolling back to the previous image using the same zero-downtime rolling update process.

---

## Environment Variables and Secrets

Secrets are never stored in the repository or baked into Docker images. They are managed separately per environment:

| Environment | Secret Storage              |
| ----------- | --------------------------- |
| Development | `.env` file (not committed) |
| Staging     | Kubernetes Secrets          |
| Production  | Kubernetes Secrets          |

The pipeline injects the correct secrets into Kubernetes at deploy time. No secret ever touches the repository or the image.

---

## Further Reading

| Topic                    | Location                                         |
| ------------------------ | ------------------------------------------------ |
| Docker and containers    | [docker.md](../infrastructure/docker.md)         |
| Kubernetes orchestration | [kubernetes.md](../infrastructure/kubernates.md) |
| Testing strategy         | [testing.md](../docs/testing.md)                 |
| Service overview         | [service.md](../architecture/services.md)        |
