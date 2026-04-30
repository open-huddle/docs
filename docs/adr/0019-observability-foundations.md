---
title: "ADR 0019 — Observability foundations: OpenTelemetry SDK and the Grafana LGTM stack"
sidebar_label: "0019 · Observability foundations"
---

# ADR 0019 — Observability foundations: OpenTelemetry SDK and the Grafana LGTM stack

**Status:** Accepted (Slices A and B)
**Date:** 2026-04-26 (Slice A); 2026-04-30 (Slice B)

## Context

The architecture overview has named **OpenTelemetry, Prometheus, Loki, Tempo, Grafana** as the observability stack since Phase 1, but no actual instrumentation has been wired into `apps/api`. Every prior ADR that touched a long-running worker — [ADR-0009](./transactional-outbox-and-audit-consumer) (audit), [ADR-0010](./search-service-and-indexer) (search indexer), [ADR-0011](./outbox-gc-and-audit-decoupling) (outbox GC), [ADR-0014](./notifications-consumer-and-mentions) (notifications), [ADR-0018](./debezium-cdc-foundations) (Debezium) — flagged metrics or pipeline-health monitoring as out-of-scope. Those out-of-scope bullets pile up.

[ADR-0018](./debezium-cdc-foundations) made the situation acute: Debezium reading the WAL is now the single publisher per cluster. If the replication slot lags or the connector dies, NATS publish stops. Realtime `Subscribe` goes silent. Without observability, the only signal is a user reporting "I sent a message and nobody saw it." That's not a monitoring story — that's no monitoring.

The right time to wire instrumentation is **before** the next signal-bearing feature lands. This ADR commits to OpenTelemetry as the SDK, picks a slicing strategy, and accepts Slice A.

## Decision

Adopt **OpenTelemetry-Go** as the single instrumentation SDK for traces and metrics. Logs stay on `slog`/stdout and are ingested into Loki by an out-of-process shipper later (Slice D). The SDK exports via OTLP/gRPC to a co-located collector; in dev compose the collector + backends + Grafana ship as a single `grafana/otel-lgtm` image behind a `--profile observability` flag.

Slice A wires the SDK and the framework instrumentation only. The work is intentionally split across slices, each independently shippable:

### Slice A — SDK + framework instrumentation behind a compose profile (this ADR, accepted)

- `apps/api/internal/observability` package owns SDK lifecycle: `Init` builds resource + tracer + meter providers, OTLP/gRPC exporters, W3C TraceContext + Baggage propagation. Returns a `Shutdown` the caller defers; the disabled path is a no-op.
- `cmd/api/main.go` calls `observability.Init` first thing after config load so every dependency opened afterwards (DB, NATS, OpenSearch, OIDC verifier) sees a working tracer/meter from its first call.
- HTTP server wrapped with `otelhttp.NewHandler`; Connect handlers wrapped with `connectrpc.com/otelconnect`'s interceptor (placed ahead of the auth interceptor so spans cover the auth check); the Postgres driver wrapped with `XSAM/otelsql` (per-query spans + connection-pool stats as OTel metrics).
- Compose: `grafana/otel-lgtm:0.8.1` — a single ~1 GB image that bundles the OTel Collector, Tempo, Prometheus, Loki, and Grafana with the backends pre-wired into Grafana datasources. Behind `profiles: [observability]`; brought up with `make dev-up-observability`.
- Default disabled. Existing deployments pay zero overhead until an operator opts in via `HUDDLE_OBSERVABILITY_ENABLED=true`.

### Slice B — worker spans + RED metrics on the worker stack (accepted)

Per-tick and per-row spans on each background worker (`audit.Consumer`, `search.Indexer`, `outbox.GC`, `notifications.Consumer`, `notifications.Mailer`, `invitations.Mailer`). Standard RED metrics published as `huddle.worker.rows_processed`, `huddle.worker.errors`, and `huddle.worker.tick_duration_seconds` — single instruments with a `worker` attribute, so dashboards `sum by (worker)` over one metric name rather than enumerating six. The `errors` counter additionally carries a `scope` attribute (`tick` vs `row`) so a noisy per-row failure doesn't drown out the more serious tick-level signal.

`outbox.GC` is the odd worker out: it issues a single bulk DELETE, not a row-loop, so it gets a tick span only and `AddRows` fires once per tick with the row count the DELETE removed.

Connect handler attribute enrichment ships as `observability.AttributeInterceptor`, which takes an `AttributeReader` function so the package stays free of an `auth`/`principal` import. The chain is `otelconnect` → `auth` → `AttributeInterceptor`; the enrichment runs after auth so claims are present in `ctx`. Today the only attribute is `huddle.user.subject` (the OIDC `sub` claim, a stable identifier). Email and other PII are deliberately not span attributes — the convention from the Slice A consequences section ("PII-bearing fields are not attribute-eligible") holds.

The `WorkerInstr` type is nil-safe end-to-end: every method short-circuits on a nil receiver. Existing unit tests construct workers without `WithWorkerInstr` and stay zero-cost, no-op behavior preserved.

### Slice C — CDC pipeline observability (the load-bearing one post-Debezium)

Postgres exporter in compose for replication-slot lag. Canned Grafana dashboard showing outbox depth (unpublished + un-stamped per consumer), Debezium slot lag, NATS consumer lag, and end-to-end Send→Subscribe latency. **This is the dashboard that answers "is the CDC pipeline healthy?"** — without it, ADR-0018's Slice C ("delete the in-process publisher") is operating blind.

### Slice D — logs ingestion

Choose between Alloy, promtail, or the OTel collector's logs receiver to ship `slog` output into Loki. The OTel logs SDK is the youngest and most volatile of the three signals; deferring it until logs ingestion has soaked is intentional.

### Slice E — Helm chart + production runbook

Helm chart for the LGTM stack components plus a runbook ("the replication slot is lagging — what do I do"). Likely shipped alongside the broader Helm-charts work tracked under the project's product roadmap rather than as its own ADR.

## Alternatives considered

- **OTel for traces, Prometheus client_golang for metrics.** Rejected. The Prometheus Go client is more battle-tested but adds a second instrumentation paradigm — every package would have to know whether to record a metric via OTel or Prometheus. The OTel-Go metrics SDK reached GA in 2024 and the OTel collector's Prometheus exporter is the supported export path; sticking with one SDK keeps the seam minimal. Trade-off accepted: the OTel metrics SDK is younger, but the cost of two SDKs is higher than the cost of one less-mature SDK.

- **OTel logs SDK from day one.** Rejected. The logs SDK is the youngest of the three signals and the conventions for `slog`-to-OTel bridging are still in flux. `slog` to stdout to Loki via Alloy/promtail is the path every Kubernetes-deployed Go service takes anyway. Slice D adopts this.

- **Per-component compose services (separate Tempo + Prometheus + Loki + Grafana containers).** Rejected. The all-in-one `grafana/otel-lgtm` image is officially maintained by Grafana Labs for exactly this dev-loop use case. ~1 GB image is large but the tradeoff is one container instead of five with pre-wired Grafana datasources. Production deployments pick components individually via Helm; dev doesn't need that flexibility.

- **Auto-instrumentation only (no manual spans).** Rejected for the long term but accepted for Slice A. `otelhttp` + `otelconnect` + `otelsql` cover the request, RPC, and database-query layers automatically — that's enough to answer "which request was slow" and "which query stalled it" on day one. App-code-level spans (the worker stack) need explicit instrumentation; deferred to Slice B because the worker pattern is the same across all six workers and is best done in one focused PR rather than mixed into Slice A.

- **Adopt observability in one big PR.** Rejected. The change touches the SDK init, three integration seams (HTTP, Connect, DB), config, compose, and the operator runbook. A bug in any of those is hard to bisect. The slice boundaries chosen here let Slice A ship and soak before Slice B starts touching the worker stack.

## Consequences

**Positive.**
- Every HTTP request, every Connect RPC, and every SQL query become spans the moment an operator sets `HUDDLE_OBSERVABILITY_ENABLED=true`. No code in the request path changes.
- Connection-pool stats (open / idle / wait counts, max-open hits) become OTel metrics. Diagnosing a stuck pool stops requiring `pg_stat_activity` access on production.
- The Grafana LGTM image makes the dev-loop story trivial: `make dev-up-observability && open http://localhost:3000`. New contributors don't need to learn three backends to view their own traces.
- Slice B (worker spans) bolts onto the same SDK with no second decision needed. Same for the future analytics consumer or any out-of-process worker — `otel.Tracer("...")` is the only seam.
- Existing deployments stay silent until an operator opts in. The default-disabled path was a deliberate choice over default-enabled-but-no-collector; the latter would silently buffer spans and exhaust memory if no one was listening.

**Negative.**
- The OTel-Go SDK is one more dependency tree the project pins. The metrics SDK (`go.opentelemetry.io/otel/sdk/metric`) reached GA in 2024 but is younger than the tracing SDK; minor-version churn during the next year is plausible. Mitigated: pinned versions in `go.mod`, single import seam in `internal/observability`, easy to update in lockstep.
- The `grafana/otel-lgtm` image is large (~1 GB). Contributors on metered connections feel the first pull. Mitigated: profile-gated; default `make dev-up` doesn't fetch it.
- A misbehaving collector can stall the API on shutdown if the bounded drain timeout is too generous. The 10s upper bound in `cmd/api/main.go` is a deliberate cap; longer just delays SIGTERM-driven termination.
- Span data leaks. The interceptors record HTTP path, RPC method, SQL statement (after parameter scrubbing) — none of that should contain user PII, but a sloppy future commit could add an attribute that does. ADR-0008's handler-level authorization rules apply: PII-bearing fields are not attribute-eligible.

## Out of scope

- **Slice C** — Postgres-exporter for replication-slot lag, canned Grafana dashboard. The load-bearing operational story for ADR-0018's CDC pipeline.
- **Slice D** — logs ingestion path (Alloy / promtail / collector logs receiver).
- **Slice E** — Helm chart for the production observability stack.
- **PII redaction in span attributes.** Convention-driven for now; an automated linter or attribute allowlist is a future ADR if the surface grows.
- **Sampling strategy.** Default head-based sampling at 100% is fine for dev and pre-alpha. Production-grade sampling (tail-based, error-priority, rate-limited) is a future ADR conditioned on traffic actually existing.
- **Cross-service distributed tracing.** Today there's one Go service. The W3C TraceContext propagation is wired so a future second service immediately participates; no further ADR needed until that second service exists.
