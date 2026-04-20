---
sidebar_position: 1
title: Deployment
description: How to deploy Open Huddle into a Kubernetes cluster or a Docker Compose host.
---

# Deployment

:::warning Pre-alpha
The Helm charts referenced on this page do not exist yet. This document is the target, not the current state.
:::

Open Huddle supports two deployment shapes:

- **Kubernetes (primary)** — Helm charts, Gateway API routing, Linkerd service mesh.
- **Docker Compose (secondary)** — single-host for small installs and local development.

## Kubernetes

### Prerequisites

- Kubernetes 1.29+
- A Gateway API controller (we ship configuration for **Traefik** as the controller, but any conforming controller should work)
- cert-manager
- A way to provide secrets — External Secrets Operator with OpenBao is the supported path

### Install

```bash
helm repo add open-huddle https://charts.open-huddle.org
helm install huddle open-huddle/huddle \
  --namespace huddle --create-namespace \
  --values values.prod.yaml
```

### Routing

North-south traffic is modeled as Gateway API objects (`Gateway`, `HTTPRoute`, `GRPCRoute`, `TLSRoute`), **not Ingress**. This is a deliberate choice — see the [ADR](../adr) directory once that decision is published.

### Service mesh

Linkerd is the recommended mesh. It provides:

- Automatic mTLS between pods (a SOC 2 control).
- Traffic metrics without per-service instrumentation.
- Rolling certificate rotation without application changes.

## Docker Compose

Use Compose for:

- Local development (documented in [Getting started](../getting-started/local-development))
- Small single-host deployments under a few hundred users

Compose files live under `deploy/compose/` in the monorepo. They are **not** compliance-ready — no mesh, no secrets manager, no TLS termination out of the box. Use them for convenience, not for production.

## What you are responsible for

Operators remain responsible for the substrate:

- TLS certificates (cert-manager handles issuance; you handle DNS and CA trust)
- Secret material (External Secrets Operator pulls from OpenBao or your provider of choice)
- Backup scheduling (pgBackRest for Postgres; Velero for cluster DR)
- Observability (the Helm chart ships with OpenTelemetry exporters; point them at your stack)

See [Observability](./observability) and [Backups](./backups) for details.
