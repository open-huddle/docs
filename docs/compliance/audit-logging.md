---
sidebar_position: 2
title: Audit logging
description: What Open Huddle records, how it is stored, and how it will feed a SIEM.
---

# Audit logging

Open Huddle's audit log is **not** application logs. It is an append-only record of state-changing events, designed to satisfy SOC 2 and HIPAA access-and-change-tracking requirements.

The first cut of the audit pipeline shipped with the Phase 3a transactional outbox — see [ADR-0009](/adr/transactional-outbox-and-audit-consumer). The sections below describe what the project records **today** and what is still **planned**; they are kept separate so operators can tell which guarantees hold now from which ones are on the roadmap.

## Today

### How events are produced

Every state-changing RPC writes an `OutboxEvent` row inside the same database transaction as the domain mutation it describes. A background consumer (`internal/audit.Consumer`) polls the outbox for rows that do not yet have an `AuditEvent` sibling, mirrors the relevant fields into `audit_events`, and relies on a `UNIQUE` constraint on `audit_events.outbox_event_id` for idempotency.

Two things follow from that shape:

- **No event is lost by a broker outage.** The audit pipeline does not read from NATS — it reads from the outbox table, which is in the same Postgres as the domain write. NATS can be down for hours; audit rows still land.
- **Audit is eventually consistent, not synchronous.** The consumer polls on a short interval (2s by default). An operator querying `audit_events` a few seconds after an RPC may not see the row yet.

### What is recorded

`AuditEvent` is a deliberate projection of `OutboxEvent`, not a superset. Today each row carries:

| Field | Source |
|---|---|
| `id` | UUID, assigned by the consumer |
| `created_at` | Timestamp when the audit row was written |
| `outbox_event_id` | Unique reference to the originating outbox row (idempotency key). Nullable: transitions to NULL after the outbox GC worker deletes the source row. The denormalized fields below carry forward unchanged, so compliance queries do not rely on this pointer. See [ADR-0011](/adr/outbox-gc-and-audit-decoupling). |
| `event_type` | Verb on the aggregate — e.g. `message.created` |
| `actor_id` | Authenticated user's Open Huddle UUID (nullable — reserved for future system-originated events) |
| `organization_id` | Tenant scope (nullable) |
| `resource_type` | `message`, `channel`, `organization`, … |
| `resource_id` | Stable UUID of the affected entity |
| `payload` | Protobuf-serialized event body |

`payload` is the same bytes the `OutboxEvent` published — subscribers and audit rows decode an identical wire format.

### Where the rows live

`audit_events` is a table in the same PostgreSQL database as the domain tables. It is **not** a separate data store today; operational separation (dedicated Postgres, dedicated disk, separate backup schedule) is a deployment choice, not a project-provided isolation boundary.

The schema is append-only by convention — the audit consumer only writes, never updates or deletes. Nothing in the application path modifies existing rows. Administrative deletion (e.g. at the end of a retention window) is an operator concern.

### Retention and GC

`audit_events` rows are never trimmed by the application — the project does not run a compliance-retention cron; operators own that policy. The **outbox** rows that feed audit, on the other hand, are trimmed by `outbox.GC` once they're fully processed and older than `outbox.retention` (default 24h). When the outbox row disappears, the audit row's `outbox_event_id` is `SET NULL` via the FK cascade; every other field on the audit row is preserved. See [ADR-0011](/adr/outbox-gc-and-audit-decoupling).

## Planned

The sections below describe the target-state audit surface. They are not implemented today; they document the contract downstream consumers should expect to be built against.

### Richer event metadata

A later phase will extend `AuditEvent` with request-scoped context that the current projection does not carry:

| Field | Notes |
|---|---|
| `event_time` | Server-authoritative timestamp of the **originating** RPC, distinct from `created_at` (which is the mirror time) |
| `actor_ip` | Client source IP, post-proxy |
| `request_id` | Propagated through the request pipeline |
| `action` | Full RPC method name — e.g. `huddle.v1.MessageService/Send` |
| `before` / `after` | Redacted diff of the affected fields — never the message body or any PHI |
| `outcome` | `SUCCESS` or an error code; today every row implies success because only committed writes emit an outbox event |

Adding these fields is mostly a matter of threading request context through to the `OutboxEvent` write — `AuditEvent` is already the passive mirror.

### Export

The audit log will export via:

- **Structured JSON** over HTTPS to a collector of your choice
- **OTLP logs signal**, for OTel-based pipelines

The default Helm chart will assume the stream is routed to your SIEM (Splunk, Elastic, Chronicle, etc.). The project does not ship a SIEM.

Until the export surface exists, operators who need audit-log egress read directly from `audit_events` via Postgres.

### Dedicated store

A future ADR may move `audit_events` onto a separate Postgres (or a different append-only store) to make retention and backup policies easier to manage independently. Today the table is co-located with the domain data.

## What is never in the audit log

- Message contents
- Attachment contents or metadata beyond size and MIME type
- Anything containing PHI / PII

If you need content for eDiscovery, that's a separate legal process against the authoritative database, not the audit log.
