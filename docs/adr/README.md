---
sidebar_position: 1
title: Architecture Decision Records
description: Index of all architecture decisions made in the Open Huddle project.
slug: /adr
---

# Architecture Decision Records

An ADR captures a **significant decision** the project has made: what the decision is, what was considered, and why the one that won, won.

The format is deliberately simple (see [ADR-0001](/adr/record-architecture-decisions)): a short document, written once, never edited after the decision is final. If a decision is revisited, a new ADR *supersedes* the old one — the old one stays, marked superseded.

## Why we keep them

- **Onboarding.** A contributor joining in 2028 can understand why the project picked Connect over plain gRPC in 2026 without asking around.
- **Compliance.** SOC 2 auditors expect to see contemporaneous records of architectural decisions, not post-hoc justifications.
- **Accountability.** Tradeoffs are visible. Future us cannot pretend the rejected options were never considered.

## Index

| ID | Title | Status |
|---|---|---|
| [0001](/adr/record-architecture-decisions) | Record architecture decisions | Accepted |
| [0002](/adr/monorepo-layout) | Monorepo layout | Accepted |
| [0003](/adr/connect-rpc-over-plain-grpc) | Connect RPC over plain gRPC | Accepted |
| [0004](/adr/versioned-migrations-ent-atlas) | Versioned migrations via Ent + Atlas | Accepted |
| [0005](/adr/markdown-for-message-body) | Markdown for message body | Accepted |
| [0006](/adr/connect-streaming-for-realtime) | Connect server-streaming for realtime | Accepted |
| [0007](/adr/event-broker-from-day-one) | Event broker from day one | Accepted |
| [0008](/adr/handler-level-authorization) | Handler-level authorization | Accepted |
| [0009](/adr/transactional-outbox-and-audit-consumer) | Transactional outbox and decoupled audit consumer | Accepted |
| [0010](/adr/search-service-and-indexer) | Search service and OpenSearch indexer | Accepted |
| [0011](/adr/outbox-gc-and-audit-decoupling) | Outbox GC and audit/outbox FK decoupling | Accepted |
| [0012](/adr/skip-locked-outbox-claim) | Multi-replica outbox claim via SELECT FOR UPDATE SKIP LOCKED | Accepted |
| [0013](/adr/email-invitations-and-email-abstraction) | Email invitations and the email abstraction | Accepted |
| [0014](/adr/notifications-consumer-and-mentions) | Notifications consumer and the mention model | Accepted |
| [0015](/adr/notification-email-delivery) | Notification email delivery and preferences | Accepted |
| [0016](/adr/message-edit-delete) | Message edit/delete + search re-keying | Accepted |

## Writing a new ADR

1. Copy an existing ADR as a template.
2. Number it one higher than the current maximum.
3. Open a PR. Discussion happens in the PR; the ADR itself should read as a final document once merged.
4. Link it from this index and from the [sidebar](https://github.com/open-huddle/docs/blob/main/sidebars.ts).
