---
title: "ADR 0012 — Multi-replica outbox claim via SELECT FOR UPDATE SKIP LOCKED"
sidebar_label: "0012 · SKIP LOCKED claim"
---

# ADR 0012 — Multi-replica outbox claim via SELECT FOR UPDATE SKIP LOCKED

**Status:** Accepted
**Date:** 2026-04-22

**Refines:** [ADR-0009](./transactional-outbox-and-audit-consumer) — specifically its "Multi-replica publisher dedup" out-of-scope bullet and the single-replica dedup assumption in `internal/outbox.Publisher`'s package doc.

## Context

ADR-0009 shipped the outbox publisher with an explicit known gap: each API replica polls `SELECT ... WHERE published_at IS NULL` and then publishes + stamps independently. With N replicas, the same row gets picked up N times — each one publishes to NATS, one stamps first, the others' UPDATEs succeed too but nothing changes. Subscribers are idempotent on message UUID so there is no user-visible bug, but the wasted bandwidth grows linearly with replicas and the log noise from the late-winner UPDATE hides real issues.

ADR-0010 landed a second outbox consumer (the search indexer) with the same shape. A notifications consumer is queued up for after email-invites. Every new publish-driven writer inherits the same gap, so closing it now keeps the fix small — two files — before the blast radius grows.

## Decision

Both `outbox.Publisher` and `search.Indexer` now run their poll query inside an `*ent.Tx` and, on Postgres, suffix the SELECT with `FOR UPDATE SKIP LOCKED`. Two replicas hitting the same predicate return disjoint row sets: the first grabs up to `batchSize` rows and holds them locked, the second's SELECT skips those and returns the next batch (or empty, if no unclaimed rows remain).

Concretely:

- **Transactional wrapper.** `PublishBatch` / `IndexBatch` open `client.Tx(ctx)`, do all reads and writes through the tx, and `Commit` at the end. `defer tx.Rollback()` guards the error paths. Per-row publish/index + stamp happens while the lock is held.
- **Dialect gate.** A new `WithDialect(dialect.Postgres)` option drives the `ForUpdate(sql.WithLockAction(sql.SkipLocked))` clause. Zero-valued dialect (the default) means "don't apply the lock clause", which is the behavior for SQLite-backed unit tests. Production wires it explicitly in `cmd/api/main.go`.
- **Ent feature flag.** `sql/lock` added to the `ent generate` invocation in the Makefile — that's what makes the `ForUpdate` method appear on the generated query types.
- **Failure semantics unchanged.** Per-row publish errors still log and continue (the row's UPDATE never runs, so `published_at` stays NULL, and the row is re-claimable next tick). A mid-batch crash before commit rolls back the whole tx — all rows return to the pool, which is safe because stamps only commit if everything committed.

## Alternatives considered

- **Advisory locks for leader election.** Rejected. Single-leader means all outbox traffic flows through one replica, which caps horizontal scale and makes the fast path harder to reason about (what happens when the leader pauses for a few seconds?). SKIP LOCKED is stateless — every replica is equal, and a stuck replica simply holds its batch until its tx times out or its process dies.

- **Application-level random jitter so replicas are less likely to collide.** Rejected. A hack that lowers the probability of the bug without fixing it. Still produces duplicates in the collision window; still wastes bandwidth when two replicas happen to poll in the same millisecond.

- **Partitioned work distribution by row-id hash.** Rejected. Would require replicas to coordinate on partition assignment (who owns which partition?), which reintroduces a leader-ish problem. SKIP LOCKED gets the same "each row goes to exactly one worker" property without the coordination layer.

- **Drop the dialect gate; assume Postgres everywhere.** Rejected. Unit tests run on SQLite for speed and zero setup; forcing Postgres just for these paths would add a container dependency to every CI job. The `dialect` option is one line of plumbing that lets both stories coexist.

- **Hold the NATS publish outside the transaction.** Considered and deliberately not done. Keeping the publish inside the tx couples lock duration to NATS latency, which is the stated tradeoff — but it avoids a "lock released, publish in flight, crash, row re-claimed, double publish" race. Given NATS calls are sub-millisecond in steady state and subscribers are idempotent either way, the simpler code path wins.

## Consequences

**Positive.**
- Multi-replica deployments are correctness-clean on the common path. A row is claimed by exactly one replica's tx; the others go around it.
- Scales linearly with replicas: N publishers drain N disjoint slices. No coordinator, no heartbeat, no "pick the leader" dance.
- The outbox GC worker ([ADR-0011](./outbox-gc-and-audit-decoupling)) doesn't need any change — it uses its own separate claim predicate and doesn't collide with an in-flight publish.
- Future consumers (notifications, whatever comes next) inherit the same claim pattern: wrap in a tx, apply the lock option on Postgres, stamp inside the tx. The publisher and indexer are the worked examples.

**Negative.**
- **Lock duration is now proportional to publish latency.** A slow NATS call holds the Postgres lock longer, which extends how far other replicas fall behind. In steady state this is sub-millisecond and invisible; under a NATS stall it is bounded by the ent tx's statement timeout plus context deadline. Operators should watch tail latency on the outbox table if NATS ever goes sideways.
- **Tx management is one more thing to get right.** The `committed := false` / `defer Rollback` pattern is small but easy to typo in a future worker. The ADR documents it; the code has comments; reviewers should flag any worker that skips the pattern.
- **Unit tests don't exercise the real behavior.** SQLite lacks FOR UPDATE SKIP LOCKED, so the multi-replica claim is only validated in Postgres integration tests (which land as part of the testcontainers backfill on the roadmap). The dialect gate means nothing in-tree actually runs the locked path; confidence comes from the ent-level SQL unit tests and the integration tests to come.

## Out of scope

- **Testcontainers-backed concurrent-claim verification.** On the roadmap as part of the broader Postgres integration test backfill.
- **NATS latency timeouts.** A future PR may add a context deadline around `bus.Publish` to bound lock hold time in a stall scenario.
- **Applying SKIP LOCKED to the audit consumer's outbox SELECT.** The audit consumer's dedup is the `UNIQUE(outbox_event_id)` constraint on `audit_events`; two replicas inserting concurrently produce one success and one UNIQUE violation that logs but doesn't corrupt. The wasted work is bounded by log noise, not correctness. Revisit if the noise is worth the tx wrapping.
- **Back-pressure metrics.** Part of the broader observability-wiring slot — not added here.
