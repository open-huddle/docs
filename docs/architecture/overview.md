---
sidebar_position: 1
title: Overview
description: How Open Huddle's services, protocols, and data flow fit together.
---

# Architecture overview

Open Huddle is composed of a small set of long-lived services that cooperate over gRPC (internally) and Connect / HTTP/2 (client-facing). This page gives you the zoomed-out picture: what exists **today** and what the architecture is heading **toward**. [Stack](./stack) lists every component and its license; [Protocols](./protocols) dives into the wire protocols.

:::warning Pre-alpha
The project is under active construction. The "Today" diagram below reflects what has merged to `main`. The "Target" diagram describes the committed architecture we are working toward. Neither is production-ready yet.
:::

## Service map — today

```text
                          ┌────────────────────┐
                          │   Browser / web    │
                          └─────────┬──────────┘
                                    │  Connect (REST / gRPC-web / server-streaming)
                                    ▼
┌──────────────┐         ┌────────────────────┐
│   Keycloak   │◄──OIDC──│     API (Go)       │
└──────────────┘         │ chi + Connect-Go   │
                         └─┬──────────────────┘
                           │ one DB transaction: domain write + outbox row
                           ▼
                  ┌────────────────────────┐
                  │      PostgreSQL        │
                  │ domain + outbox_events │
                  │      + audit_events    │
                  └─┬──────────────┬───┬───┘
      polls un-     │              │   │    polls un-audited rows
      published ────┘              │   └──── mirrors to audit_events
                   │    polls un-  │                ▲
                   │    indexed    │                │
                   │    rows ──────┘                │
                   ▼                                │
         ┌──────────────────┐   ┌──────────────────┐
         │ outbox.Publisher │   │  audit.Consumer  │
         │   (in-process)   │   │   (in-process)   │
         └────────┬─────────┘   └──────────────────┘
                  │ publish
                  ▼
         ┌──────────────────┐   ┌──────────────────┐
         │  NATS JetStream  │◄──│ MessageService   │
         │  (realtime bus)  │   │    .Subscribe    │
         └──────────────────┘   │ (streaming RPC)  │
                                └──────────────────┘

         ┌──────────────────┐     ┌──────────────────┐
         │ search.Indexer   │────►│   OpenSearch     │
         │   (in-process)   │     │ huddle-messages  │
         └──────────────────┘     └─────────┬────────┘
                                            │
                                            ▼
                                 ┌──────────────────┐
                                 │  SearchService   │
                                 │ .SearchMessages  │
                                 └──────────────────┘

         ┌──────────────────┐
         │    outbox.GC     │── deletes fully-stamped rows older
         │   (in-process)   │   than retention; audit siblings'
         └──────────────────┘   outbox_event_id → NULL via FK cascade

         ┌──────────────────┐         ┌─────────────────────┐
         │ invitations.     │────────►│   email.Sender      │
         │   Mailer         │         │ (log / smtp driver) │
         │ (in-process)     │         └─────────────────────┘
         └──────────────────┘

         ┌──────────────────┐         ┌─────────────────────┐
         │ notifications.   │────────►│   notifications     │── in-app inbox
         │    Consumer      │         │     (Postgres)      │   via NotificationService
         │  (in-process)    │         └─────────┬───────────┘
         └──────────────────┘                   │
                                                │ emailed_at IS NULL
                                                ▼
                            ┌──────────────────────────────────┐
                            │       notifications.Mailer       │
                            │  (in-process; skips opt-outs via │
                            │   NotificationPreference)        │
                            └────────────────┬─────────────────┘
                                             │ email.Sender.Send
                                             ▼
                                    ┌──────────────────┐
                                    │    email.Sender  │
                                    │ (log / smtp)     │
                                    └──────────────────┘
```

Today's path, in order:

1. **Authenticate.** A JWT from Keycloak is verified by a Connect interceptor; unauthenticated requests are rejected at the edge. See [ADR-0008](/adr/handler-level-authorization) for the authn/authz split.
2. **Authorize.** `policy.Engine.Authorize` runs at the handler before any write touches the database.
3. **Write.** The API writes the domain row (e.g. `Message`) and an `OutboxEvent` row in a single Postgres transaction. Either both commit or neither does — see [ADR-0009](/adr/transactional-outbox-and-audit-consumer).
4. **Drain.** `outbox.Publisher` polls un-published outbox rows and publishes each to the NATS subject stored on the row (`huddle.messages.created.<channel_id>` for message sends). See [ADR-0007](/adr/event-broker-from-day-one) for the broker choice.
5. **Fan out in real time.** Connected clients on `MessageService.Subscribe` receive events via ephemeral JetStream consumers. See [ADR-0006](/adr/connect-streaming-for-realtime).
6. **Mirror to audit.** `audit.Consumer` polls outbox rows that have no sibling `AuditEvent` and writes an idempotent mirror to `audit_events`. Runs independently of NATS — a broker outage does not lose audit events.
7. **Index for search.** `search.Indexer` polls outbox rows of type `message.created` that have no `indexed_at` stamp yet, decodes the protobuf payload, and upserts the projection into OpenSearch. `SearchService.SearchMessages` reads from the same cluster. See [ADR-0010](/adr/search-service-and-indexer).
8. **GC the outbox.** `outbox.GC` deletes fully-stamped outbox rows (published + indexed + audited) once they age past retention. The FK on `audit_events.outbox_event_id` is `ON DELETE SET NULL`, so audit rows survive the delete with their denormalized fields intact. See [ADR-0011](/adr/outbox-gc-and-audit-decoupling).
9. **Send invitation emails.** `invitations.Mailer` polls the `invitations` table for pending rows, renders the email, hands it to `email.Sender` (log-driver in dev, smtp-driver in prod), records an `EmailDelivery` row, stamps `email_sent_at`, and clears the plaintext token. Separate from the outbox so the token never lands in `audit_events`. See [ADR-0013](/adr/email-invitations-and-email-abstraction).
10. **Fan out notifications.** `notifications.Consumer` polls outbox rows with `notified_at IS NULL`. For `message.created` events it decodes the payload, reads the `mention_user_ids`, and writes one `Notification` per mentioned user (UNIQUE on `(recipient, message, kind)` keeps retries idempotent). Non-message event types get their `notified_at` stamped without further work so `outbox.GC` can proceed. `NotificationService.{List, MarkRead}` serves the resulting inbox. See [ADR-0014](/adr/notifications-consumer-and-mentions).
11. **Email pending notifications.** `notifications.Mailer` polls `Notification` rows where `emailed_at IS NULL` and the recipient hasn't opted out (no matching `NotificationPreference` row OR one with `email_enabled = true`). Joins `Channel` + `User` + `Message` for the body, sends via `email.Sender`, stamps `emailed_at`. Same opt-out-by-default shape as Slack / GitHub. Preferences live at `NotificationService.{GetPreferences, SetPreference}`. See [ADR-0015](/adr/notification-email-delivery).

`MessageService.Edit` and `Delete` also feed the outbox — `message.edited` emits `message_edited`-sourced notifications (in-app only, not emailed) and re-indexes the search doc by message id; `message.deleted` soft-deletes the row and removes the search doc. See [ADR-0016](/adr/message-edit-delete).

A few supporting pieces live in the stack but are not yet wired into the API: **Valkey** runs in `make dev-up` for future presence and rate-limiting use; **LiveKit** is slated for voice/video in a later phase.

## Service map — target

The architecture commits to an event-sourced backbone with multiple consumers, external CDC, and a service mesh. It exists on paper; the pieces below are not yet built.

```text
                          ┌────────────────────┐
                          │   Browser / web    │
                          └─────────┬──────────┘
                                    │  Connect / HTTP/2
                                    ▼
┌──────────────┐         ┌────────────────────┐         ┌──────────────────┐
│   Keycloak   │◄──OIDC──│     API (Go)       │─────────►  LiveKit (SFU)  │
└──────────────┘         │ chi + Connect-Go   │  WebRTC └──────────────────┘
                         └─┬───┬───┬──────────┘
                           │   │   │
                 ┌─────────┘   │   └──────────────┐
                 ▼             ▼                  ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
        │  PostgreSQL  │ │   Valkey     │ │ NATS JetStream   │
        └──────┬───────┘ └──────────────┘ └──────────────────┘
               │ WAL                              ▲
               ▼                                  │
        ┌──────────────┐                          │
        │   Debezium   │──────────────────────────┘
        └──────────────┘
                                                  │
                           ┌──────────────────────┼──────────────────────┐
                           ▼                      ▼                      ▼
                  ┌───────────────┐      ┌──────────────┐       ┌───────────────┐
                  │  OpenSearch   │      │ Audit log    │       │ Notifications │
                  │   indexer     │      │   consumer   │       │   consumer    │
                  └───────────────┘      └──────────────┘       └───────────────┘
```

Compared to today:

- **Debezium replaces the in-process publisher.** The CDC reader tails the Postgres WAL (including the `outbox_events` table) and publishes to NATS from its own process. The audit and search consumers move off polling onto the broker. See ADR-0009's "Out of scope" for the migration path.
- **Notifications** in-app side shipped with [ADR-0014](/adr/notifications-consumer-and-mentions); email-on-mention + per-kind preferences shipped with [ADR-0015](/adr/notification-email-delivery). The target picture above still lumps them together as "Notifications consumer"; in reality it's two in-process workers plus the `email.Sender` abstraction.
- **Service mesh** (Linkerd) handles east-west mTLS automatically. The API stops doing any service-to-service authentication in application code.

## Why this shape

Three design decisions shape everything else, today and target:

- **One `.proto` defines the client-server contract.** Connect generates the Go handler, the TypeScript client, and works with gRPC and gRPC-web. No dual maintenance. See [ADR-0003](/adr/connect-rpc-over-plain-grpc).
- **Events, not orchestration.** Services never call each other synchronously for side effects. If something happens because of a write, it happens by consuming an event. The audit consumer already works this way — it never sees an RPC, only outbox rows.
- **Standard components.** Keycloak, LiveKit, OpenSearch, NATS, Postgres are well-understood, battle-tested, and FOSS. Open Huddle is the glue, not a rewrite.

This event-sourced backbone is the reason the project can meet SOC 2 and HIPAA audit requirements without bolting auditing on as a second system: the audit log is a projection of the same event stream that drives search and notifications. See [Audit logging](../compliance/audit-logging) for what the projection contains today vs. target.
