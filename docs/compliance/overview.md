---
sidebar_position: 1
title: Overview
description: Open Huddle's SOC 2 / HIPAA compliance posture.
---

# Compliance overview

Open Huddle targets organizations that need to self-host collaboration under **SOC 2** and **HIPAA**. Compliance is a design constraint, not an afterthought.

:::info
The project itself does not hold a SOC 2 Type II report or a HIPAA certification. Compliance certifications apply to **deployments**, not to software. This page describes the controls the software provides so operators can pass their own audits.
:::

## What the project provides

- **Audit logging.** Every state-changing RPC emits an event that is projected into an append-only audit log ([Audit logging](./audit-logging)).
- **mTLS east-west.** Linkerd injects certificates automatically. Plaintext service-to-service traffic is not a supported configuration.
- **Encryption in transit.** Connect / gRPC / WebSockets over TLS; the Helm chart assumes cert-manager is installed.
- **Encryption at rest.** Guidance and backup tooling (pgBackRest) support encrypted backups; object storage defaults ask for encrypted buckets.
- **Least-privilege access.** OIDC / SAML / LDAP via Keycloak. Role-based authorization checks run before any write.
- **Data handling.** Message bodies and attachments are classified as PHI in HIPAA deployments and never logged ([Data handling](./data-handling)).

## What operators own

- The **certification** itself — SOC 2 auditors audit your organization's deployment, not the project.
- **Retention policies.** The project exposes the knobs; you set the values to match your regime.
- **Access reviews, training, vendor management** — classic SOC 2 requirements that live outside the software.
- **Business Associate Agreements** under HIPAA — between you and your downstream providers.

## What's explicitly out of scope

- FedRAMP: not a current target. A future ADR may revisit.
- PCI-DSS: irrelevant — Open Huddle does not process payments.
- Multi-tenant SaaS hosting: out of scope. The project is single-tenant self-hosted, period.
