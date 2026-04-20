---
title: "ADR 0007 — Event broker from day one"
sidebar_label: "0007 · Event broker from day one"
---

# ADR 0007 — Event broker from day one

**Status:** Accepted
**Date:** 2026-04-20

## Context

Phase 2c needed to fan out new messages from one API replica to every connected subscriber. The simplest possible implementation — an in-process `map[channelID][]chan Message` guarded by a mutex — works in development and breaks the moment a second API replica exists, because a message sent on replica A never reaches a subscriber on replica B.

We had to decide whether to build that in-process shim now and upgrade later, or wire the production broker on the first phase that actually needs it. The project's architecture commits to **NATS JetStream** as the event backbone for audit, search, and notification consumers (see [Architecture overview](../architecture/overview)) — those phases are not built yet, but they are not optional either.

## Decision

NATS JetStream is part of the Open Huddle stack from Phase 2c onward. The broker runs in `deploy/compose/docker-compose.yml` for local development; it is a non-optional dependency of `apps/api`.

Concretely:

- A single stream named `messages` covers all message-related events. Subjects are versioned: `huddle.messages.created.<channel_id>` for now, leaving room for `huddle.messages.deleted.<channel_id>` and similar without subject collisions.
- Retention is bounded — 24 hours and 100 000 messages, whichever comes first, with `DiscardOld`. JetStream is the live fast-path; **PostgreSQL remains the source of truth**. Clients backfill missed messages via `MessageService.List` on reconnect.
- Realtime subscribers use **ephemeral consumers** (`DeliverNewPolicy` + `AckNonePolicy` + 30s `InactiveThreshold`). No client-side state is required; server resources self-clean when a client drops.
- Send-side publish is **best-effort**: if NATS is briefly unavailable, the database write still succeeds and the API returns 200. Subscribers may miss live events during the outage window; the future Debezium CDC pipeline (Phase 3) will provide guaranteed downstream delivery for audit and search.

## Alternatives considered

- **In-process pub/sub (`map[channelID][]subscriber`).** Rejected. Single-replica only. Every consumer the architecture has on the roadmap (audit log, OpenSearch indexer, notifications) needs a broker anyway, so the in-process implementation would have to be ripped out next phase — the worst kind of throwaway code.

- **Postgres LISTEN/NOTIFY.** Rejected. Postgres pub/sub works for the realtime fan-out shape but fails on the consumer use cases that drove the broker decision in the first place: audit needs durability and replay, search needs decoupling from the write path, notifications need fan-out across worker pools. Adding a broker later means two messaging systems to operate.

- **Postpone realtime until the broker exists "for real" (Phase 3+).** Rejected. We would have shipped a "messaging API without realtime" and forced operators to choose between a degraded experience and waiting indefinitely. The broker is small, well-understood, and self-hosting-friendly; the cost of adding it is far below the cost of a feature gap.

- **Redis Streams / Valkey Streams.** Rejected. Valkey is already in the stack for cache and presence, but its streams are less mature for the consumer shapes we know we need (durable pull consumers per worker, replay, message-at-least-once for audit). NATS JetStream is purpose-built for that pattern.

## Consequences

**Positive.**
- Horizontal scale works on day one. A message sent on any API replica reaches subscribers on every replica that has a matching consumer.
- The broker the architecture documented as "future" is the broker in production. No "we'll cut over later" debt.
- Phase 3 consumers (Debezium CDC → audit log → search → notifications) can subscribe to the same `messages` stream and add new streams as they land. The `huddle.<domain>.<verb>` subject convention is established.
- Operators self-hosting Open Huddle add one more long-lived service (NATS), which they will need anyway. Its operational story (monitoring at `:8222`, `nats-server -js`, file-storage volume) is small.

**Negative.**
- One more service in `make dev-up`. A laptop without enough RAM for Postgres + Keycloak + Valkey + NATS + the API may struggle. Not a real constraint on modern dev machines.
- Phase 2c uses ephemeral consumers, which means a subscriber connected during a broker restart misses messages until they reconnect and call List. Acceptable for live chat; the durable consumer story (per-user offline catch-up) is a future ADR when offline-first becomes a requirement.
- `apps/api` now hard-fails at startup if NATS is unreachable. We chose this over a degraded "best-effort" startup so operators see the misconfiguration immediately rather than discover it on the first Subscribe call. Trade documented at the call site (`cmd/api/main.go`).

## Out of scope

- Durable per-user consumers for offline catch-up (separate ADR when needed).
- Cross-cluster NATS federation / leaf nodes (multi-region story).
- Replacing best-effort publish with transactional outbox + Debezium CDC (Phase 3).
