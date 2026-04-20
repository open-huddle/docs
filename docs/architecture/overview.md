---
sidebar_position: 1
title: Overview
description: How Open Huddle's services, protocols, and data flow fit together.
---

# Architecture overview

Open Huddle is composed of a small set of long-lived services that cooperate over gRPC (internally) and Connect / WebSockets (client-facing). This page gives you the zoomed-out picture; [Stack](./stack) lists every component and its license, and [Protocols](./protocols) dives into the wire protocols.

## Service map

```text
                          ┌────────────────────┐
                          │   Browser / web    │
                          └─────────┬──────────┘
                                    │  Connect (REST/gRPC-web) + WebSocket
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
        └──────────────┘ └──────────────┘ └───────┬──────────┘
                                                  │
                                      Debezium + consumers
                                                  │
                           ┌──────────────────────┼──────────────────────┐
                           ▼                      ▼                      ▼
                  ┌───────────────┐      ┌──────────────┐       ┌───────────────┐
                  │  OpenSearch   │      │ Audit log    │       │ Notifications │
                  └───────────────┘      └──────────────┘       └───────────────┘
```

## Data flow

Every state-changing request to the API follows the same pattern:

1. **Authenticate.** A JWT from Keycloak is verified by a Connect interceptor; unauthenticated requests are rejected at the edge.
2. **Authorize.** Policy checks run before any write touches the database.
3. **Write.** The API writes to PostgreSQL through Ent. The write and its side effects are part of a single transaction.
4. **Emit.** Debezium captures the Postgres change log and publishes events onto NATS JetStream.
5. **Consume.** Downstream workers consume the events to update OpenSearch, the audit log, push notifications, and other projections.

This event-sourced backbone is the core reason the project can meet SOC 2 and HIPAA audit requirements without bolting auditing on as a second system: the audit log is a projection of the same event stream that drives search and notifications.

## Why this shape

Three design decisions shape everything else:

- **One `.proto` file defines the client-server contract.** Connect generates the Go handler, the TypeScript client, and works with gRPC and gRPC-web. No dual maintenance.
- **Events, not orchestration.** Services never call each other synchronously for side effects. If something happens because of a write, it happens by consuming an event.
- **Standard components.** Keycloak, LiveKit, OpenSearch, NATS, Postgres are well-understood, battle-tested, and FOSS. Open Huddle is the glue, not a rewrite.

See [Stack](./stack) for the full inventory and [Protocols](./protocols) for the on-wire details.
