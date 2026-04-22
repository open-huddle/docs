---
title: "ADR 0011 — Outbox GC and audit/outbox FK decoupling"
sidebar_label: "0011 · Outbox GC + audit decoupling"
---

# ADR 0011 — Outbox GC and audit/outbox FK decoupling

**Status:** Accepted
**Date:** 2026-04-22

**Refines:** [ADR-0009](./transactional-outbox-and-audit-consumer) — specifically the "UNIQUE outbox_event_id on audit_events" phrasing, which stated the constraint as an insert-time idempotency guarantee against a NOT NULL column. After this ADR, `audit_events.outbox_event_id` is **nullable** (still UNIQUE); the at-insert dedup guarantee is unchanged, but the column transitions to NULL after the outbox GC worker deletes the source row.

## Context

Phase 3a ([ADR-0009](./transactional-outbox-and-audit-consumer)) and Phase 3b-1 ([ADR-0010](./search-service-and-indexer)) left the outbox table growing without bound. Three downstream consumers now stamp three independent markers when they process a row — `published_at` from `outbox.Publisher`, an `audit_events` sibling from `audit.Consumer`, and `indexed_at` from `search.Indexer` — but nothing deletes a row once all three have completed. ADR-0009 and ADR-0010 both listed outbox GC as an out-of-scope follow-up. This is that follow-up.

Naively deleting fully-processed outbox rows fails at the FK. The original schema declared `audit_events.outbox_event_id NOT NULL` with `ON DELETE NO ACTION`, so Postgres rejects any `DELETE FROM outbox_events` while an audit sibling exists. Audit retention (compliance-driven, commonly > 1 year) is supposed to outlive outbox retention (operational, commonly < 1 day) by orders of magnitude — the FK direction made the longer-lived row depend on the shorter-lived one, which is the wrong shape.

## Decision

Two changes, landing in one PR:

1. **Schema: audit_events.outbox_event_id becomes nullable, FK cascades to `SET NULL`.**
   - Field: still `UNIQUE`, still `Immutable` from the app's perspective. Nullable so Postgres can clear the column when the referenced outbox row is deleted.
   - FK: `ON DELETE NO ACTION` → `ON DELETE SET NULL`. The database, not the application, breaks the reference.
   - The denormalized fields on `audit_events` (`event_type`, `actor_id`, `organization_id`, `resource_type`, `resource_id`, `payload`) are the source of truth for compliance queries post-GC. The FK is an insert-time dedup guard, nothing more.
   - `UNIQUE` on a nullable column is allowed in Postgres: multiple NULLs do not collide, so the at-insert dedup guarantee survives untouched.

2. **New `outbox.GC` worker.**
   - Polls outbox rows where `published_at IS NOT NULL AND indexed_at IS NOT NULL AND HasAuditEvent AND created_at < now - retention`, in batches, and deletes them.
   - Retention is operator-configurable via `outbox.retention` (default 24h). Interval defaults to 5 minutes and batch size to 500 — GC is housekeeping, not a hot path, so its cadence is much looser than the publisher or indexer loops.
   - Runs as a fourth in-process goroutine in `apps/api` alongside `outbox.Publisher`, `audit.Consumer`, and `search.Indexer`.
   - Two-phase delete: `SELECT ids LIMIT batchSize` then `DELETE WHERE id IN (ids)`. Postgres has no `DELETE ... LIMIT`; ent's bulk Delete becomes one round-trip on Postgres and SQLite both, and the FK cascade handles audit fixup server-side.

The ordering between GC and future consumers is now structural: any consumer that lands later MUST also stamp a marker (column, sibling row, whatever) before GC considers the row done. Adding a fourth consumer without extending the GC predicate would risk deleting a row mid-projection — the existing predicate covers three consumers and only three.

## Alternatives considered

- **Drop the FK entirely.** Rejected. The at-insert UNIQUE + FK is the core of the dedup guarantee in ADR-0009; removing the FK makes orphan audit rows possible via bad inserts, not just via GC. The schema should still express "audit rows reference a real outbox row at insert time" even if it doesn't hold forever. `SET NULL` encodes both invariants at once.

- **Keep the FK, delete outbox + audit together at GC time.** Rejected outright. Compliance policy requires audit rows to live for their full retention window independent of operational storage. An outbox GC policy that also deleted audit rows would be a compliance bug.

- **Partition the outbox by time and drop old partitions.** Rejected for now. Attractive at very high scale (avoids the DELETE at all), but adds a partition management dependency (pg_partman) and makes the cross-consumer "did everyone stamp?" predicate harder to express (the predicate spans all three stamps, not just age). When the outbox is a partitioned table in some later phase, the GC worker can be replaced by a simple "drop partitions older than N + retention" cron — the predicate is what makes the current design usable today.

- **Move the FK to the outbox side (outbox.audit_event_id).** Rejected. Backward — we'd then have to `ON DELETE SET NULL` the outbox when audit rows are deleted, but the audit consumer is never the one deleting. The current direction matches the lifetime shape: audit lives longer, so the shorter-lived table is the one whose deletion must cascade.

- **Soft-delete the outbox row (flag a column, leave the row in place).** Rejected. The whole point of the GC is to bound storage; a soft-delete keeps the row and wastes the table space we're trying to reclaim.

## Consequences

**Positive.**
- Outbox growth is bounded. Fully-processed rows vacate once they age past retention; disk usage stays proportional to recent throughput, not total lifetime throughput.
- Audit rows outlive the outbox by design, as compliance expects. The schema now makes the lifetime relationship explicit: audit is independent, outbox is ephemeral.
- Adding a future consumer (notifications, Debezium, whatever) requires extending the GC predicate to include its marker — a review-visible change, not a silent invariant break.
- Multi-replica safety comes free. Two GC workers hitting the same eligible row race on the `DELETE`; Postgres serializes and one wins, the other deletes zero rows. Logged as "partial delete" without retrying (the row is gone either way).

**Negative.**
- **Schema migration touches audit_events.** `DROP NOT NULL` is metadata-only in Postgres; `DROP CONSTRAINT + ADD CONSTRAINT` for the FK action change takes an `ACCESS EXCLUSIVE` lock briefly, which is fine at current scale and may need to be reworked for a live migration at high-write operators. Documented on the local-development page.
- **Audit queries that joined back through the FK no longer work after GC.** They have to use the denormalized fields — which is the original intent (ADR-0009 explicitly designed audit as denormalized), but worth stating: post-GC, there is no way to answer "what was the original outbox row?" beyond what audit stored itself.
- **GC is a separate concern from CDC.** When Debezium lands ([ADR-0009 out of scope](./transactional-outbox-and-audit-consumer)), CDC reads outbox rows before GC trims them. The order of operations is "Debezium publishes the CDC event → local consumers stamp their markers → GC deletes the row" and that ordering must hold. Debezium's replication slot keeps a cursor into the WAL that survives the DELETE, so the concern is only "can Debezium publish fast enough to stay ahead of retention?" — an operational knob, not a schema one.

## Out of scope

- **Per-event-type retention.** Today retention is one duration for every row. Long-term, some event types may justify longer retention (e.g. channel.deleted if a future feature undoes it from the outbox); today they all share the same window.
- **Backpressure if GC cannot keep up.** The batch cap (500) and interval (5m) give a throughput ceiling of ~100k deletions/hour per replica. Faster-writing workloads may need a tighter interval or larger batch. No alarm is wired yet; operators observe table size as the signal.
- **Observability.** GC emits a log line on partial deletes and nothing on steady-state success. Metrics/traces for deletion throughput are a future observability-wiring PR.
- **Debezium coordination.** CDC → GC ordering is described above in prose; it becomes a concrete concern when Debezium lands.
- **Undelete / replay.** There is no "resurrect a GC'd outbox row" path. The denormalized audit row is the artifact that survives; if a future consumer needs replay, it consumes from the outbox *before* retention, or from an external CDC stream that captured the insert.
