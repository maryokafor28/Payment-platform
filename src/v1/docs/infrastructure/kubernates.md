# Kubernetes

## Version

V1

---

## Overview

Kubernetes handles container orchestration in production. It takes the Docker images built by the CI/CD pipeline, runs them as containers, manages scaling, handles failures automatically, and routes traffic between service instances.

While Docker-compose runs infrastructure locally during development, Kubernetes runs everything in production — both the infrastructure and the application services.

---

## Why Kubernetes

| Requirement                 | How Kubernetes Meets It                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Auto-scaling                | Scales service instances up or down based on traffic automatically |
| Self-healing                | Automatically restarts crashed containers                          |
| Service discovery           | Services find each other by name — no hardcoded IPs                |
| Load balancing              | Distributes traffic across multiple instances of a service         |
| Zero-downtime deployments   | Rolling updates — new version replaces old gradually, no downtime  |
| Independent service scaling | Scale only the Payment Service without touching Auth or Support    |

---

## Core Concepts Used

### Pod

The smallest deployable unit in Kubernetes. A pod runs one container — one instance of a service. If the pod crashes, Kubernetes restarts it automatically.

### Deployment

Manages a set of identical pods for a service. Defines how many instances (replicas) should run and handles rolling updates when a new image is deployed.

### Service (Kubernetes Service)

A stable internal address for a set of pods. Even if pods restart and get new IPs, the Kubernetes Service address stays the same. Other services use this address to communicate.

### Ingress

The single external entry point into the cluster. All public traffic hits the Ingress, which routes it to the API Gateway. No other service is exposed externally.

### HorizontalPodAutoscaler (HPA)

Automatically increases or decreases the number of pod replicas based on CPU or memory usage. If payment traffic spikes, the Payment Service scales up — Auth and Support are unaffected.

---

## Cluster Structure

```
Internet
    ↓ HTTPS
Ingress (Load Balancer)
    ↓
API Gateway pods          ← only service exposed via Ingress
    ↓ internal cluster network
├── Auth Service pods         :3001
├── Payment Service pods      :3002
├── Notification Service pods :3003
└── Support Service pods      :3004
        ↕
├── PostgreSQL
├── Redis
└── RabbitMQ
```

---

## Independent Scaling

Each service scales independently. If the Payment Service receives heavy traffic, only Payment Service pods are scaled up. Auth, Support, and Notification continue running at their normal replica count.

```
Normal traffic:
  auth-service        → 2 pods
  payment-service     → 2 pods
  support-service     → 2 pods
  notification-service → 2 pods

Payment traffic spike:
  auth-service        → 2 pods      (unchanged)
  payment-service     → 8 pods      (scaled up by HPA)
  support-service     → 2 pods      (unchanged)
  notification-service → 2 pods     (unchanged)
```

---

## Deployments Per Service

Each service has its own Kubernetes Deployment. A deployment defines:

- Which Docker image to run
- How many replicas to start with
- Resource limits (CPU and memory per pod)
- Health check endpoints (liveness and readiness probes)
- Environment variables injected from Kubernetes Secrets

---

## Health Checks

Kubernetes checks two probes per pod:

| Probe           | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| Readiness probe | Is this pod ready to receive traffic? If not, traffic is not sent to it |
| Liveness probe  | Is this pod still alive? If not, Kubernetes restarts it automatically   |

Each service exposes a `GET /health` endpoint that returns `200 OK` when the service is running correctly.

---

## Secrets Management

Sensitive values — database credentials, JWT secrets, Redis URLs, RabbitMQ credentials — are stored as Kubernetes Secrets and injected into pods as environment variables at runtime. They are never hardcoded in Deployment manifests or Docker images.

---

## Rolling Updates

When a new image is deployed, Kubernetes replaces pods gradually:

```
Deploy new version of Payment Service
      ↓
Kubernetes starts one new pod with new image
      ↓
New pod passes readiness probe
      ↓
One old pod is terminated
      ↓
Repeat until all old pods are replaced
      ↓
Zero downtime — traffic always routed to healthy pods
```

If the new pod fails its readiness probe, the rollout stops and the old pods continue serving traffic.

---

## Relationship to CI/CD

Kubernetes does not build images — it only runs them. The CI/CD pipeline builds the Docker image, pushes it to a container registry, and then instructs Kubernetes to deploy the new image. See `ci-cd.md` for the full pipeline.

```
Developer pushes code
      ↓
CI/CD pipeline builds Docker image
      ↓
Image pushed to container registry
      ↓
Kubernetes pulls new image
      ↓
Rolling update begins
```

---

## Further Reading

| Topic                 | Location                                  |
| --------------------- | ----------------------------------------- |
| Docker and containers | [docker.md](../infrastructure/docker.md)  |
| CI/CD pipeline        | [ci-cd.md](../docs/ci-cd.md)                |
| Service overview      | [service.md](../architecture/services.md) |
| Observability         | [logging.md](../logging.md)               |
