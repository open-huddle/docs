---
title: "ADR 0010 — Search service and OpenSearch indexer"
sidebar_label: "0010 · Search + indexer"
---

# ADR 0010 — Search service and OpenSearch indexer

**Status:** Accepted
**Date:** 2026-04-22

## Context

Phase 3a landed the transactional outbox and a decoupled audit consumer ([ADR-0009](./transactional-outbox-and-audit-consumer)). The stack now has exactly one consumer (audit) reading the outbox; every consumer the architecture roadmaps — search, notifications, eventual Debezium — is still unbuilt.

Search is both the biggest user-visible Phase 3 feature and the most mechanical: indexing a message projection and serving `q` against it. Building it second (after audit) lets us validate the outbox pattern on a non-audit consumer before it has to carry three or four of them. It also forces the small but important question of how additional consumers stamp "already processed" without stepping on each other.

## Decision

Add a `SearchService.SearchMessages` RPC backed by OpenSearch. A new `internal/search` package maintains the projection in lock-step with the outbox: an in-process `Indexer` worker polls outbox rows of type `message.created`, decodes the protobuf payload, and upserts the doc into an alias-backed index. A new `indexed_at` column on `OutboxEvent` (nullable timestamp, indexed) records that a row has been projected, mirroring the role `published_at` plays for the NATS publisher.

Concretely:

- **Schema change:** `ALTER TABLE outbox_events ADD COLUMN indexed_at timestamptz NULL` plus an index on `(indexed_at, created_at)`. Same shape as `published_at` so the indexer's poll filter is a cheap index-only scan as the table grows.
- **Consumer shape:** `internal/search.Indexer` mirrors `internal/audit.Consumer` — `Run(ctx)` loop, exported `IndexBatch(ctx)` for deterministic tests, 2s default interval, 200-row default batch. Failures on a single row (transient OpenSearch outage, malformed payload) log and continue; the batch never aborts.
- **Dedup:** the OpenSearch document `_id` is the originating outbox-event UUID. A retried index call is an upsert by construction — the indexer needs no "did I already send this?" bookkeeping beyond the `indexed_at` stamp.
- **Index layout:** one concrete index `huddle-messages-v1` behind an alias `huddle-messages`. Handlers and the indexer only ever speak to the alias. Mapping changes ship as `v2` + reindex + atomic alias flip — no client-visible breaking change.
- **Tenant isolation:** every OpenSearch query the handler builds includes a `term` filter on `organization_id`, regardless of other parameters. The caller is also authorized at the organization level via `policy.ActionReadMessage` before the handler touches the backend. Two layers of check on the same invariant.
- **Snippet format:** OpenSearch's highlighter is configured with `pre_tags: "**"` / `post_tags: "**"` so matched tokens arrive as Markdown-bold fragments. Clients render hits with the same Markdown pipeline they already use for message bodies; there is no per-client highlight renderer.
- **Cursor:** the opaque `next_cursor` is `base64url(json(last_hit.sort))`. OpenSearch's `search_after` takes exactly that tuple. The handler does not interpret the sort values, so mapping changes that alter the sort shape do not require a cursor migration in application code.
- **Bootstrap:** at startup, `apps/api` fails fast if it cannot reach OpenSearch — same policy as NATS. `EnsureIndex` creates the concrete index + alias idempotently; subsequent starts are no-ops.

## Alternatives considered

- **Postgres full-text search (`tsvector` / `tsquery`).** Rejected. It would ship without a new container in the dev stack and avoids operating OpenSearch, but it couples search load to the write database (bad for scale), can't share an index with the attachment-text pipeline we have planned (Tika → OpenSearch), and doesn't give us the phrase/highlight/ranking primitives operators expect. OpenSearch is already in the committed stack; the cost is incremental.

- **Elasticsearch.** Rejected on licensing. Elastic relicensed to SSPL in 2021; OpenSearch is the AWS-led Apache 2.0 fork, already the declared backend in the architecture stack page.

- **Meilisearch / Typesense / Sonic.** Rejected. Smaller operational footprint, but none of them handle the tokenization + attachment extraction + aggregations story we already need for the rest of Phase 3 (Tika, analytics). Adding a second search system later is the opposite of the "standard building blocks" principle.

- **Read OpenSearch events from NATS instead of the outbox.** Rejected — on the same reasoning as ADR-0009's audit decision. Reading from the outbox makes the indexer independent of broker health and removes any "did NATS deliver?" failure mode from the search pipeline. The broker is for realtime fan-out; the outbox is for durable projections.

- **A separate `IndexedEvent` sibling table, matching `AuditEvent`.** Rejected. The audit table exists because the audit projection has compliance retention requirements that demand a Postgres witness. The search projection lives in OpenSearch; there is no reason to keep a second "yes we projected this" row in Postgres beyond a timestamp. A boolean/timestamp column is smaller and avoids another 1:1 join.

- **Add a new `policy.ActionSearchMessage`.** Rejected as unnecessary precision today. Search is effectively read. When a product need emerges to authorize search distinctly from list — e.g. "regulated users may read a channel they are in but cannot search across channels at once" — we split the action.

## Consequences

**Positive.**
- Second outbox consumer ships without touching the first. The audit flow is unchanged; the new column is orthogonal to `published_at`. Consumers are independent columns, not sequential pipes.
- OpenSearch is the committed stack backend, now live — search, attachment text extraction (via Tika later), and any future analytics/aggregation surface all read from the same cluster.
- Tenant isolation is structural: the handler cannot forget to filter by `organization_id` because the backend method requires it (zero UUID → error) and the mapping rejects a document without one (`dynamic: strict`).
- Reindex is a supported operation by construction. Concrete index versioning plus the alias flip means the failure mode of "oops we need to change the body analyzer" is a documented operational step, not a breaking change.
- The `search.Client` interface keeps handler and indexer free of the opensearch-go dependency for testing — fakes and alternate backends (Meili in a one-off experiment, an in-memory stub for a contributor without Docker) are a 30-line job.

**Negative.**
- **One more long-lived service in `make dev-up`.** OpenSearch's idle memory footprint (~512 MiB as configured) is noticeable on laptops already running Postgres + Keycloak + NATS + API. Dev-mode `DISABLE_SECURITY_PLUGIN=true` cuts the startup cost; production enables it back via the Helm chart.
- **Polling latency.** Default 2s indexer cadence means a just-sent message is findable 2–3s later in the average case. Tunable per deployment; a LISTEN/NOTIFY-driven indexer is a future optimization if operators care.
- **Backfill for existing deployments.** Messages created before the indexer shipped have outbox rows, so an in-place upgrade works without a bootstrap migration. Deployments older than Phase 3a — there are none yet, but worth naming — would need a one-shot reindex CLI that re-emits from the domain tables. Out of scope today.
- **No search under MLS.** End-to-end encryption, when it lands, removes the server's ability to see message bodies. Search in that mode becomes per-client or per-channel keyed. The current indexer will not index MLS-encrypted rows; the architecture ADR for MLS will define the replacement.
- **`indexed_at` becomes part of outbox GC's precondition.** Outbox rows are only safe to trim once they're published (`published_at`), audited (has `audit_events` sibling), AND indexed (`indexed_at`). This tightens the GC rule but does not block any other work.

## Out of scope

- **Outbox GC worker.** Its preconditions now include `indexed_at`; landing the worker itself is the next reliability-sweep PR.
- **Debezium CDC.** Unchanged by this ADR. Debezium would read the same `outbox_events` table and publish to NATS; the indexer would then consume from NATS rather than poll. Migration is additive.
- **Attachment text search.** Tika extraction → OpenSearch is the natural next consumer on the same cluster. A separate ADR when the upload pipeline lands.
- **Search across aggregates other than messages.** Channel-directory search, user-directory search, etc. The `SearchService` surface is versioned (`v1`) so additions are non-breaking.
- **Dashboards plugin / OpenSearch Dashboards container.** Not shipped in compose; operators can install it if they want the UI.
- **MLS interplay.** Covered by the future MLS ADR.
