---
title: "ADR 0004 — Versioned migrations via Ent + Atlas"
sidebar_label: "0004 · Versioned migrations (Ent + Atlas)"
---

# ADR 0004 — Versioned migrations via Ent + Atlas

**Status:** Accepted
**Date:** 2026-04-20

## Context

Open Huddle's authoritative store is PostgreSQL, and the Go API uses [Ent](https://entgo.io) as its ORM. Ent can manage schema in several ways:

1. **Auto-migrate** at startup from the in-code schema (`client.Schema.Create`).
2. **Versioned migrations** — Ent produces SQL files on demand, and a separate tool applies them.

The project's target audience is self-hosting organizations with **SOC 2** and **HIPAA** obligations. Any schema change landing in production must be reviewable in a pull request, replayable by an operator, and auditable after the fact.

## Decision

We generate **versioned SQL migrations** from the Ent schema, format them with the Atlas formatter, and apply them with the [Atlas CLI](https://atlasgo.io).

Concretely:

- `apps/api/ent/schema/` — Ent schema definitions (source of truth).
- `apps/api/cmd/migrate/` — a tiny program that calls `ent/migrate.NamedDiff` with `atlas.DefaultFormatter`, producing a numbered `.sql` file and updating `atlas.sum`.
- `apps/api/migrations/` — committed migration files plus the integrity sum.
- `apps/api/atlas.hcl` — Atlas environment configuration; the migrations directory is `file://migrations`.
- `apps/api/scripts/migrate-diff.sh` — spins up a throwaway Postgres container (same major version as the compose stack, controlled by a single `POSTGRES_IMAGE` variable) so the diff is computed against a clean replay of every existing migration, not against the developer's local DB.
- `make migrate-diff NAME=<desc>` — generate a new migration.
- `make migrate-apply` / `make migrate-status` — apply and inspect against a target database.

The versioned-migration feature flag (`sql/versioned-migration`) is enabled in `ent/generate.go` so the generated `ent/migrate` package exposes `NamedDiff`.

## Alternatives considered

- **Ent auto-migrate at startup (`client.Schema.Create`).** Rejected. Schema changes would not be reviewable in a PR, rollback would require out-of-band intervention, and auditors cannot point at a single artifact that records exactly which DDL ran in production.

- **Pure Atlas schema-as-code (HCL), no Ent integration.** Rejected. We already use Ent for type-safe query building; duplicating the schema in HCL creates two sources of truth. Ent produces the schema for free from the code we already write.

- **`atlas-provider-ent` (Atlas CLI reads the Ent schema directly).** Rejected for two reasons: (a) the provider repository could not be resolved through the public module proxy during initial setup, so it was not a reliable dependency; (b) using Ent's built-in `NamedDiff` with Atlas's `DefaultFormatter` yields the same on-disk format with one fewer external dependency.

- **Goose / golang-migrate with hand-written SQL.** Rejected. Hand-written DDL diverges from the Ent schema over time, and Ent's type-safe queries require the generated code in any case.

## Consequences

**Positive.**
- Every schema change lands as a committed `.sql` file in a PR; reviewers see exactly what will run in production.
- `atlas.sum` enforces integrity: tampering with a past migration is caught.
- Atlas's built-in `migrate lint` (planned for CI) can block destructive operations before they merge.
- Operators run the same `atlas migrate apply` command in every environment — local, staging, production — with the same migrations directory.
- Rollback uses `atlas migrate down`, also reviewable in PRs.

**Negative.**
- Developers need Docker available locally to run `make migrate-diff` (ephemeral Postgres for diff computation). Acceptable because Docker is already required for the dev stack.
- A second driver (`lib/pq`, deprecated) is imported in the migrate command only, because Ent's diff API calls `sql.Open("postgres", ...)` with a hardcoded driver name. The runtime API uses `pgx`. The trade is documented at the import site.
- Adding the `sql/versioned-migration` feature flag expands the generated `ent/migrate` package slightly. Acceptable — it is generated code.

**Scope note.** This ADR covers *how* migrations are produced and applied. Policy around destructive changes (when a column can be dropped, how long to keep compatibility shims) belongs in a future ADR when we have a running deployment to care about.
