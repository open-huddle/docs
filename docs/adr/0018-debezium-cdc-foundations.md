---
title: "ADR 0018 — Debezium CDC for outbox publish (foundations)"
sidebar_label: "0018 · Debezium CDC foundations"
---

# ADR 0018 — Debezium CDC for outbox publish (foundations)

**Status:** Accepted (all three slices).
**Date:** 2026-04-25 (Slice A); 2026-04-26 (Slices B and C)

**Refines:** [ADR-0009](./transactional-outbox-and-audit-consumer) — replaces the in-process `outbox.Publisher` with WAL-driven CDC. Refines [ADR-0012](./skip-locked-outbox-claim) — SKIP LOCKED stops being load-bearing once Debezium is the sole publisher (one bridge process, one publish per row). Builds on [ADR-0007](./event-broker-from-day-one)'s NATS JetStream backbone.

## Context

ADR-0009 shipped the transactional outbox with an in-process publisher: every API replica runs its own goroutine that polls `outbox_events`, publishes each unstamped row to NATS, and stamps `published_at`. ADR-0012 added `FOR UPDATE SKIP LOCKED` so concurrent replicas drain disjoint batches instead of double-publishing. Both decisions explicitly named **Debezium CDC** as the eventual replacement — and both treated that replacement as a Phase 3 follow-up, deferred until enough downstream consumers had validated the table-as-event-log pattern.

That precondition is met. Three consumers (audit, search indexer, notifications) are running off the same `outbox_events` table. The realtime `MessageService.Subscribe` is the only customer of NATS itself. The longest-deferred infrastructure item — moving NATS publish out of the API process — is now safe to take on, and the operational cost of waiting is starting to bite:

- Every new API replica adds one more publisher goroutine, one more SKIP LOCKED contender, one more set of broker connections. Linear in replicas with no upside past the first one.
- The publisher worker holds a Postgres transaction for the duration of each publish round-trip to NATS. A NATS slowdown stalls the publisher, which extends the duration `published_at` rows pile up — a load amplification that does not exist when the publisher is decoupled.
- Out-of-process consumers running in their own services (a future analytics pipeline, a SIEM mirror) need the canonical event stream to live somewhere they can subscribe to without reaching into the API's database. CDC gives them that.

The cutover is large enough that doing it in one PR would be reckless. This ADR records the **slicing strategy** and accepts **Slice A (foundations only)**. Slices B and C are tracked under "Out of scope" for separate ADR-or-implementation decisions.

## Decision

Adopt **Debezium Server** as the production publisher path: a sidecar that reads the Postgres WAL via `pgoutput`, applies the **Outbox Event Router SMT** to flatten each `outbox_events` INSERT into a topic + payload, and publishes to NATS JetStream with the topic taken verbatim from the row's stored `subject` column.

Land the change in three slices, each independently shippable:

### Slice A — foundations behind a compose profile (this ADR, accepted)

- Postgres in `deploy/compose/docker-compose.yml` boots with `wal_level=logical` and pinned `max_wal_senders` / `max_replication_slots`. These values are the Postgres 18 defaults; pinning them makes the contract explicit and survives a default change. Logical replication is harmless when nothing's reading it — non-Debezium dev runs see no behavior difference.
- A `debezium` Postgres role is created on first-volume boot with `LOGIN REPLICATION` (no superuser) plus narrow `SELECT` privileges on the public schema.
- Debezium Server runs as a `profiles: [debezium]` service. `make dev-up` does **not** start it; `make dev-up-debezium` does. Its config maps the `outbox_events` schema to the SMT's expected fields, uses `route.by.field=subject` so the row's stored NATS subject becomes the destination topic, and emits `format.value=binary` so the message body on NATS is the raw protobuf bytes — byte-for-byte identical to what the in-process publisher writes today, so subscribers' `proto.Unmarshal` path doesn't change.
- The in-process `outbox.Publisher` continues to run unchanged. While the `debezium` profile is active alongside it, every outbox row is published to NATS twice — once by each path. Subscribers key on message UUID and are robust to dupes, but this is **not** the production end-state. The duplicate window exists only when both publishers are deliberately running in the same environment, and it closes in Slice B.

### Slice B — app-side cutover toggle (accepted 2026-04-26)

Shipped. `outbox.publisher.driver` config (`in_process` | `none`, default `in_process`). When `none`, `cmd/api/main.go` skips starting the in-process publisher goroutine and logs a `Warn` stating that an out-of-band CDC bridge MUST be publishing, or realtime Subscribe sees no events. `config.Load` validates the value strictly — a typo'd driver fails startup with an error naming the offending key, so a misconfiguration cannot silently disable fan-out.

The operator runbook for "switch to Debezium" is now: bring up the Debezium profile (`make dev-up-debezium`) **and** set `HUDDLE_OUTBOX_PUBLISHER_DRIVER=none`. Until both happen, Debezium coexists with the in-process publisher and the duplicate-publish window applies; with both in place, Debezium is the sole publisher and there are no duplicates.

### Slice C — flip the default and remove the in-process worker (accepted 2026-04-26)

Shipped. The in-process `outbox.Publisher` is deleted along with the `outbox.publisher.driver` config field, the two driver constants, and the validation block in `config.Load`. The `outbox.GC` worker stays — it deletes rows once all consumer markers are set, which is unrelated to who published. The publisher half of [ADR-0012](./skip-locked-outbox-claim) is moot in this configuration; its indexer half stands because `search.Indexer` is still an in-process worker.

Soak time was deliberately compressed — Slice B was on `main` only briefly before Slice C landed. The trade-off was accepted because the rollback for Slice C is a clean revert (Slice A's compose profile and Slice B's toggle are independent and not affected) and the project is pre-alpha, not a production deployment with users.

## Alternatives considered

- **Stay on the in-process publisher with SKIP LOCKED, indefinitely.** Rejected. SKIP LOCKED solves the "two replicas double-publish" symptom; it does not solve "publisher is co-located with the API," which couples NATS publish latency to the request path's database connection pool and makes scaling NATS publish independent of API replicas impossible. The in-process path was always the bridge, not the destination.
- **Build a custom Postgres-WAL → NATS bridge in Go.** Rejected. Logical decoding has well-known sharp edges (slot management, snapshot semantics, replication identity, schema evolution) and Debezium has spent years sanding them. Re-implementing the connector for one consumer is the kind of "reinvent infrastructure that already exists" the project's stack policy explicitly avoids.
- **Use Kafka Connect with a Debezium connector + a NATS sink connector.** Rejected. Kafka Connect adds Kafka as a dependency the architecture has deliberately not adopted. Debezium **Server** is the embedded variant that uses Connect's runtime without the Kafka coupling; the NATS JetStream sink ships in the box. Same connector logic, no extra broker.
- **Adopt Debezium in one big PR (no slicing).** Rejected. The change touches Postgres config, compose, init SQL, Debezium config, app code, and the operator runbook simultaneously. A bug in any of those is hard to bisect. The slice boundaries chosen here let Slice A ship and soak before Slice B touches `cmd/api/main.go`.

## Consequences

**Positive.**
- The in-process publisher's "one goroutine per replica" cost goes to zero in Slice C. NATS publish becomes a property of the deployment topology, not the API replica count.
- Debezium-driven publish is decoupled from the API's database transaction lifetime. A NATS slowdown no longer stalls API request paths through the publisher's lock contention.
- Out-of-process consumers (future analytics, SIEM mirror, cross-region replication) get a canonical event stream they can subscribe to without reaching into the API's database. The CDC pipeline becomes the integration seam.
- Schema and downstream subscribers are unchanged. The `payload` column already carries protobuf bytes; the SMT's `format.value=binary` mode emits those bytes verbatim. ADR-0009's "publisher is a byte pipe" decision pays off here — the bridge is config, not code.

**Negative.**
- One more service in the operator's mental model. Debezium Server is a Quarkus app with its own monitoring endpoints, offsets file, and replication slot to keep an eye on. The `dev-up-debezium` flow exposes operators to it before they have to run it for real.
- During Slice A, while the `debezium` profile is active, every outbox row is published to NATS twice. Subscribers dedupe on message UUID so the user-visible UI is fine, but it's wasteful. Slice B closes this window; until Slice B ships, treat the profile as a validation tool, not a steady-state configuration.
- Postgres now requires `wal_level=logical`. Self-hosters who run the bundled compose get this for free; operators bringing their own Postgres need to ensure the cluster is configured for logical replication. Documented in the ADR and the local-dev page.
- Replication slots leak if Debezium is removed without dropping its slot — a stuck slot blocks WAL recycling and eventually fills the disk. Standard Debezium operational concern, called out here so it's not surprising.

## Out of scope

- **Slice B** — `outbox.publisher.driver` config in `apps/api`. Separate PR; same architectural decision, different layer.
- **Slice C** — removing the in-process publisher entirely. Conditioned on Slice B soaking in a production-shaped deployment.
- **Helm chart** for Debezium Server. Compose covers the dev story; the production-grade deployment story is part of the broader Helm-charts work tracked separately.
- **Multi-source CDC** (capturing other tables beyond `outbox_events`). The architecture standardizes on the outbox as the single integration seam — direct CDC of domain tables would re-introduce the schema-coupling the outbox exists to avoid.
- **Snapshot-on-startup mode.** This ADR sets `snapshot.mode=never` deliberately: replaying historical outbox rows to NATS would clobber every active subscriber's UI. If a future scenario needs a backfill (e.g. seeding a new analytics consumer), it should run as a separate one-off process against the table directly, not via the live CDC pipeline.
