---
sidebar_position: 1
title: Introduction
description: What Open Huddle is, who it is for, and where to go next.
slug: /intro
---

# Introduction

**Open Huddle** is an open-source, self-hostable alternative to proprietary team collaboration suites such as Microsoft Teams. It is designed from day one for enterprise-scale self-hosted deployments — targeting 10,000-user organizations — with **SOC 2** and **HIPAA** compliance as first-class concerns rather than retrofits.

:::warning Pre-alpha
The project is under active initial construction. Interfaces, schemas, and architecture are subject to change without notice. Do not run it in production yet.
:::

## What's in scope

- Rich text messaging with threads, reactions, and mentions
- Public and private channels
- One-to-one and group voice and video calls (WebRTC)
- Full-text search across messages, channels, and attachments
- Enterprise SSO — OIDC, SAML, LDAP / Active Directory — via Keycloak
- Compliance-grade audit logging
- Self-hosted deployment via Helm (Kubernetes) or Docker Compose
- End-to-end encrypted messaging (MLS) — planned, not built yet

## Who this is for

Open Huddle is built for:

- **Regulated organizations** — healthcare, finance, government, defense — that cannot run collaboration on a vendor-managed SaaS.
- **Privacy-first companies** that want to own their data and their infrastructure.
- **Enterprises** that need an open, auditable alternative to proprietary suites while keeping feature parity for their employees.

If you just need a lightweight chat for a small team, consider something simpler. Open Huddle optimizes for the 10,000-user, multi-region, compliance-bound case.

## Design principles

1. **100% OSI-approved FOSS.** No SSPL, no BSL, no source-available-but-not-free dependencies.
2. **Self-hosted first.** Customers own their infrastructure and their data. The project is not built around a hosted service.
3. **Compliance by architecture.** Event-sourced audit trail, mTLS east-west, encryption at rest, least-privilege access — built in, not bolted on.
4. **Enterprise-scale by default.** Every design decision assumes a 10,000-user deployment is possible on the chosen stack.
5. **Standard building blocks.** Where a well-maintained FOSS component exists, use it. Do not reinvent Keycloak, LiveKit, or OpenSearch.

## Where to go next

- [Getting started](./getting-started/overview) — tour the project and stand it up locally.
- [Architecture](./architecture/overview) — how the pieces fit together.
- [Operators](./operators/deployment) — deploying Open Huddle into your own cluster.
- [Contributors](./contributors/development-setup) — building and contributing back.
- [Compliance](./compliance/overview) — the SOC 2 / HIPAA posture and what it means for operators.
- [Architecture decision records](./adr) — every significant decision the project has made.
