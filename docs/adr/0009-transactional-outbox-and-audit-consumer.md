---
title: "ADR 0009 — Transactional outbox and decoupled audit consumer"
sidebar_label: "0009 · Transactional outbox + audit"
---

# ADR 0009 — Transactional outbox and decoupled audit consumer

**Status:** Accepted
**Date:** 2026-04-21

**Partially supersedes:** [ADR-0007 — Event broker from day one](./event-broker-from-day-one) — specifically the "send-side publish is best-effort" bullet under its Decision, and the "replacing best-effort publish with transactional outbox + Debezium CDC (Phase 3)" bullet under its Out of scope. The broker choice, subject convention, and ephemeral-consumer realtime path from ADR-0007 stand unchanged.

## Context

ADR-0007 wired NATS JetStream in on Phase 2c with an explicit compromise: the API wrote to Postgres and then published to NATS on a best-effort basis. A broker outage between those two calls silently dropped the event — the DB row existed, subscribers never saw it, and there was no record anywhere that a publish had been attempted. That was acceptable for a live-chat-only surface (clients reconcile with `MessageService.List` on reconnect), but Phase 3 adds two consumers that cannot tolerate loss:

- **Audit log.** SOC 2 and HIPAA require a durable, append-only record of every state-changing event. An event that never makes it onto the broker is an audit event that never gets written — and there is no way, after the fact, to tell it's missing.
- **Search, notifications, future CDC consumers.** Anything reading from the event stream inherits the same loss window. The longer the list of consumers grows, the more valuable "we promise every write produces exactly one event" becomes.

Phase 3a had to close that window before the first compliance-grade consumer (audit) shipped.

## Decision

Every domain write that needs to be observed downstream enqueues a row in a **transactional outbox table** (`OutboxEvent`) inside the **same database transaction** as the mutation it describes. A background `outbox.Publisher` drains the table to NATS; a separate `audit.Consumer` mirrors outbox rows into an `AuditEvent` table independently of broker health.

Concretely:

- **Schema.** `outbox_events` and `audit_events` live in the same Postgres as the domain tables. `outbox_events` carries the denormalized context downstream consumers need (`aggregate_type`, `aggregate_id`, `event_type`, `subject`, `payload`, `actor_id`, `organization_id`, `resource_type`, `resource_id`, `created_at`, `published_at`). `audit_events` holds the immutable compliance projection. A 1:1 edge with a `UNIQUE` constraint on `audit_events.outbox_event_id` enforces at-most-once audit per outbox row at the database.
- **Write path.** `MessageService.Send` now opens one `ent` transaction, inserts the `Message`, and inserts the `OutboxEvent` with the NATS subject precomputed (`huddle.messages.created.<channel_id>`) and the proto-serialized payload attached. The handler returns 200 only if both succeed. The former "write message, then publish on a collapsed `events.Publisher.Publish(subject, payload)` byte pipe" is gone.
- **Publisher.** `internal/outbox.Publisher` polls `WHERE published_at IS NULL ORDER BY created_at`, publishes the row's payload verbatim to the stored subject, and stamps `published_at`. Per-row publish failures are logged and retried next iteration — the loop never stalls on one bad row. Defaults: 1s interval, 100-row batches (`outbox.WithInterval`, `outbox.WithBatchSize` for overrides).
- **Audit consumer.** `internal/audit.Consumer` polls `OutboxEvent` rows that lack a sibling `AuditEvent` (`NOT EXISTS` via the ent edge) and inserts the mirrored row. The `UNIQUE` constraint on `outbox_event_id` is the idempotency signal — a duplicate insert loses the race cleanly, is logged, and the loop moves on. The consumer does **not** read from NATS — it is deliberately decoupled from broker health so a broker outage cannot lose an audit event.
- **Publisher plumbing.** `events.Publisher` collapsed to a single byte-level method: `Publish(ctx, subject string, payload []byte) error`. The outbox row owns the subject and payload; the publisher has no dispatch logic. The old per-event-type NATS adapter disappeared.
- **Runtime.** Both workers run as goroutines in `apps/api` alongside the HTTP server. Each API replica runs one publisher and one audit consumer.

## Alternatives considered

- **Debezium CDC from day one.** Rejected for Phase 3a. Debezium is the medium-term target (ADR-0007 names it explicitly) — it removes the in-process publisher and opens events to consumers running in their own processes. It also adds a Kafka-compatible dependency (Debezium Server → NATS is the likely bridge) and a second moving part in every local developer's `make dev-up`. Phase 3a's goal was "no more silent loss" before the audit consumer lands; the outbox gets us there with zero new infra. Debezium becomes additive later: it can read the same `outbox_events` table and the in-process publisher becomes a fallback or is retired. Tracked as a Phase 3 reliability follow-up.

- **Two-phase commit between Postgres and NATS.** Rejected. NATS JetStream does not offer an XA-style coordinator, and even if it did, distributed transactions across heterogeneous systems are an operational nightmare that the outbox pattern was invented to avoid. The outbox gives the same guarantee — "DB write and event production are atomic" — by keeping both sides in one store (Postgres) and deferring delivery to an idempotent consumer.

- **Listen for completion inside the handler (publish-then-persist, or persist-then-publish with retries in-request).** Rejected. Both inflate request latency with broker-round-trip work, and neither survives an API crash between the two steps. The outbox cleanly decouples response time from delivery; the handler returns on commit, and the worker makes delivery eventually-consistent in the background.

- **Postgres `LISTEN/NOTIFY` as the bus between writer and publisher.** Rejected. Still single-region, still not durable across restarts without extra work, and it overlaps the NATS story ADR-0007 already committed to. Would have added a second messaging path for one phase.

- **Write audit from the handler directly (skip the outbox for audit).** Rejected. Tempting for simplicity, but it either re-introduces the same best-effort-delivery problem for audit specifically (if done after commit) or forces every handler to know about the audit table (if done in-transaction). The outbox is the one chokepoint every write passes through; building audit as a projection of the outbox means a single `audit.Consumer` covers every RPC that ever emits an event — no per-handler audit-call plumbing.

## Consequences

**Positive.**
- Message-plus-event is atomic. A committed message has an outbox row; an uncommitted message produces neither. Broker outages delay delivery, they do not lose events.
- Audit events are broker-independent. Compliance trails survive arbitrary NATS downtime; the SOC 2 "no event was dropped" story holds without caveats.
- `events.Publisher` is a byte pipe. The publisher worker has no knowledge of event shape — adding a new event type touches the handler that writes it, not the publisher. Future consumers (OpenSearch indexer, notifications, Debezium bridge) bolt onto the same table.
- Idempotency is structural. `UNIQUE outbox_event_id` on `audit_events` and the subscriber convention of keying on message UUID both survive duplicate publishes, which is what we rely on under the known multi-replica dedup gap below.
- Migration path to Debezium is clean: swap the in-process publisher for a CDC reader of the same `outbox_events` table; no handler, no schema, no subscriber changes.

**Negative.**
- **Polling latency.** Outbox drain cadence defaults to 1s and audit cadence to 2s. Realtime subscribers feel this — the send-to-fanout path has an extra up-to-1-second hop compared to the old direct-publish flow. Acceptable for chat; visible in benchmarks. Tunable per workload; a true notify-driven publisher (LISTEN/NOTIFY trigger on insert) is a future optimization if latency bites.
- **Multi-replica publishes duplicate.** Each API replica runs its own publisher; with N replicas, the same row may publish up to N times. Subscribers are idempotent on message UUID so the user-visible effect is zero, but the dedup is happening in the consumer rather than the producer. A `SELECT ... FOR UPDATE SKIP LOCKED` batch claim or advisory-lock leader election fixes this; it is Postgres-specific and deferred because we do not run multi-replica today.
- **Outbox table grows unbounded.** Rows are not deleted after publish + audit mirror. A GC worker that trims rows older than the retention floor (both `published_at IS NOT NULL` **and** a sibling `audit_events` row exists) is a known follow-up. Until it lands, operators rely on Postgres table-space headroom.
- **Audit table duplicates outbox denormalized columns.** `actor_id`, `organization_id`, `resource_*`, `payload` live in both. Storage cost is real; the alternative (audit joins back to outbox, outbox eventually GCs, audit breaks) is worse. Kept intentional.
- **Writes are a bit more expensive.** Every state-changing RPC pays one extra `INSERT` inside its transaction. Measurable, but small relative to the network and application cost of the RPC itself.

## Out of scope

- **Debezium CDC bridge.** Replaces the in-process publisher with a Postgres WAL → NATS pipeline. Required for out-of-process consumers (search in its own service, compliance archival to an external system). Not blocking Phase 3b; tracked as a Phase 3 reliability follow-up.
- **Multi-replica publisher dedup.** `FOR UPDATE SKIP LOCKED` claim or advisory-lock leader election. Preconditioned by the first multi-replica deployment.
- **Outbox GC worker.** Trim rows where `published_at IS NOT NULL` AND an `audit_events` sibling exists AND `created_at < now - retention`.
- **Durable per-user consumers for offline catch-up.** Different problem — message delivery to clients who were offline, not producer→broker delivery. Separate ADR when offline-first becomes a requirement.
- **Audit-log export surface.** The internal projection is what this ADR covers. Shipping the `audit_events` table to a SIEM (OTLP logs, JSON-over-HTTPS, Kafka mirror) is a future ADR — see [Audit logging](../compliance/audit-logging) for the eventual export contract.
