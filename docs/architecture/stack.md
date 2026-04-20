---
sidebar_position: 2
title: Stack
description: Every component in Open Huddle, its license, and why it was chosen.
---

# Stack

Every component below is **OSI-approved FOSS**. No SSPL, no BSL, no source-available-but-not-free licenses.

## Frontend

| Component | License | Role |
|---|---|---|
| React + TypeScript + Vite | MIT / Apache 2.0 | SPA framework and build tooling |
| Ant Design | MIT | Component library |
| Connect-ES | Apache 2.0 | Browser client for the Connect protocol |

## Backend API

| Component | License | Role |
|---|---|---|
| Go + `net/http` + chi | MIT | HTTP router |
| Connect-Go | Apache 2.0 | RPC layer — generates REST + gRPC + gRPC-web from one `.proto` |
| Ent | Apache 2.0 | ORM |
| Atlas | Apache 2.0 | Schema migrations |
| Viper | BSD-3 | Configuration |
| Buf | Apache 2.0 | Proto linting and code generation |

## Realtime

| Component | License | Role |
|---|---|---|
| LiveKit | Apache 2.0 | WebRTC SFU for voice / video |
| coturn | BSD | TURN / STUN |

## Data layer

| Component | License | Role | Why this one |
|---|---|---|---|
| PostgreSQL + pgaudit | PostgreSQL License + Apache 2.0 | Primary store | Compliance-grade audit module is built in |
| Valkey | BSD | Cache / presence | Redis relicensed to SSPL in 2024; Valkey is the Linux Foundation fork |
| SeaweedFS | Apache 2.0 | Object storage | MinIO is AGPL, which spooks enterprise procurement |

## Events

| Component | License | Role |
|---|---|---|
| NATS JetStream | Apache 2.0 | Internal event bus |
| Debezium | Apache 2.0 | Postgres CDC → NATS |

## Search

| Component | License | Role | Why this one |
|---|---|---|---|
| OpenSearch | Apache 2.0 | Full-text search | Elasticsearch relicensed to SSPL; OpenSearch is the AWS-led Apache fork |
| Apache Tika | Apache 2.0 | Attachment text extraction | |

## Identity and secrets

| Component | License | Role | Why this one |
|---|---|---|---|
| Keycloak | Apache 2.0 | OIDC / SAML / LDAP / MFA / SSO | Enterprise non-negotiable |
| OpenBao | MPL | Secrets management | Vault moved to BSL; OpenBao is the Linux Foundation fork |
| External Secrets Operator | Apache 2.0 | Sync secrets into Kubernetes | |

## Gateway and networking

| Component | License | Role |
|---|---|---|
| Traefik (as Gateway API controller) | MIT | North-south routing — we use the **Gateway API**, not Ingress |
| cert-manager | Apache 2.0 | TLS certificates |
| Coraza WAF | Apache 2.0 | Web application firewall |

## Observability

| Component | License | Role |
|---|---|---|
| OpenTelemetry | Apache 2.0 | Instrumentation |
| Prometheus | Apache 2.0 | Metrics |
| Loki | AGPL | Logs (run as-is, unmodified) |
| Tempo | AGPL | Traces (run as-is, unmodified) |
| Grafana | AGPL | Dashboards (run as-is, unmodified) |

## Security and compliance

| Component | License | Role |
|---|---|---|
| Linkerd | Apache 2.0 | Automatic east-west mTLS |
| Falco | Apache 2.0 | Runtime threat detection |
| OPA / Gatekeeper | Apache 2.0 | Policy-as-code admission control |
| Trivy | Apache 2.0 | Image scanning |
| pgBackRest | MIT | Encrypted Postgres backups |
| Velero | Apache 2.0 | Cluster DR |
| ClamAV | GPL (isolated service) | Attachment AV scanning |

## Media

| Component | License | Role |
|---|---|---|
| FFmpeg | LGPL build only | Media transcoding — we avoid GPL codec configurations |
| ImageMagick | ImageMagick License | Image processing |

## Platform

| Component | License | Role |
|---|---|---|
| Kubernetes + Helm | Apache 2.0 | Primary deployment target |
| Docker Compose | Apache 2.0 | Secondary / local development |
