---
sidebar_position: 2
title: Local development
description: Bring up the Open Huddle stack on your laptop.
---

# Local development

These instructions reflect the **current pre-alpha state** of the project. They will expand as more services land.

## Prerequisites

- **Go** (matching the version in [`apps/api/go.mod`](https://github.com/open-huddle/huddle/blob/main/apps/api/go.mod))
- **Node.js** 20+ and **pnpm** 10+
- **Docker** with Compose
- **[Atlas](https://atlasgo.io/getting-started)** for applying database migrations
- **[buf](https://buf.build/product/cli)** for proto code generation
- **make**

## Clone and bootstrap

```bash
git clone https://github.com/open-huddle/huddle.git
cd huddle
make install
```

`make install` runs `pnpm install` and `go work sync` so every workspace package resolves.

## Start local dependencies

```bash
make dev-up
```

This starts the supporting services via Docker Compose:

| Service | Port | Notes |
|---|---|---|
| **PostgreSQL** | 5432 | Hosts both the `huddle` (API) and `keycloak` databases. |
| **Valkey** | 6379 | In-memory cache and presence store. |
| **Keycloak** | 8180 (HTTP), 9000 (management) | Identity provider; realm `huddle` is auto-imported on first boot. |

Stop them with `make dev-down`. Add `-v` (i.e. `docker compose -f deploy/compose/docker-compose.yml down -v`) to wipe data — needed when you change the realm import or the Postgres init scripts, since both run only on first-volume boot.

## Apply database migrations

```bash
make migrate-apply
```

The API uses [Ent](https://entgo.io) for the schema and [Atlas](https://atlasgo.io) for versioned, auditable migrations — see [ADR-0004](/adr/versioned-migrations-ent-atlas) for the rationale. Migration files live under [`apps/api/migrations/`](https://github.com/open-huddle/huddle/tree/main/apps/api/migrations).

To generate a new migration after editing an Ent schema:

```bash
make migrate-diff NAME=add_channels    # writes apps/api/migrations/<ts>_add_channels.sql
```

`make migrate-status` shows what is and isn't applied against the local database.

## Run the API

```bash
make api-run
```

The API listens on `:8080` by default. It serves:

- `POST /huddle.v1.HealthService/Check` — public health RPC.
- `POST /huddle.v1.IdentityService/WhoAmI` — **requires a valid Bearer token**.
- `GET /livez` — Kubernetes liveness probe (process-only).
- `GET /readyz` — Kubernetes readiness probe (pings PostgreSQL).

Verify the public surface:

```bash
curl -X POST http://localhost:8080/huddle.v1.HealthService/Check \
  -H "Content-Type: application/json" -d '{}'
# {"status":"STATUS_SERVING","version":"dev"}

curl -i http://localhost:8080/readyz   # 200 if PostgreSQL is reachable, 503 otherwise
```

## Get a token from Keycloak

The dev realm seeds one user — **`alice` / `alice`** (`alice@example.com`, "Alice Anderson") — and one client (`huddle-web`) with the password grant enabled for testing. Production deployments will not enable the password grant.

```bash
TOKEN=$(curl -sS -X POST \
  http://localhost:8180/realms/huddle/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=huddle-web&username=alice&password=alice&scope=openid email profile" \
  | jq -r .access_token)
```

The token's `aud` claim contains `huddle-api` (the audience the API enforces) thanks to the audience mapper in the realm import.

## Call an authenticated RPC

```bash
curl -X POST http://localhost:8080/huddle.v1.IdentityService/WhoAmI \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}'
# {"userId":"<uuid>","subject":"<keycloak sub>","email":"alice@example.com","displayName":"Alice Anderson"}
```

The first authenticated call for a given OIDC subject **upserts** the user into the `users` table; subsequent calls return the same `userId` and refresh `email`/`displayName` from the latest token claims.

Without a token, `WhoAmI` returns HTTP 401 (Connect code `unauthenticated`):

```bash
curl -i -X POST http://localhost:8080/huddle.v1.IdentityService/WhoAmI \
  -H "Content-Type: application/json" -d '{}'
# HTTP/1.1 401 Unauthorized
```

## Keycloak admin console

The admin console is at [http://localhost:8180](http://localhost:8180) — credentials **`admin` / `admin`** (dev only). The `huddle` realm is pre-imported with the `huddle-web` client and the `alice` test user. Edits made in the console persist in the `keycloak` database; they are **not** written back to `deploy/compose/keycloak/huddle-realm.json`. To make a change permanent for other contributors, edit the JSON and re-seed via `make dev-down -v && make dev-up`.

## Run the web app

In a separate terminal:

```bash
make web-run
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/huddle.v1/*` to the API on `:8080`, so the health card should render "serving". Browser-based OIDC integration ships in a later phase.

## Regenerating protos

After editing anything under `proto/`:

```bash
make proto
```

Generated code under `gen/` is committed. Re-run tests and lints after regenerating.

## Useful targets

| Target | What it does |
|---|---|
| `make lint` | Runs golangci-lint, ESLint, and `buf lint`. |
| `make test` | Runs Go tests. |
| `make fmt` | Formats Go and TypeScript sources. |
| `make api-build` | Builds the Go API binary into `apps/api/bin/api`. |
| `make web-build` | Production-builds the web app into `apps/web/dist`. |
| `make ent-generate` | Regenerates Ent code from `apps/api/ent/schema/`. |
| `make migrate-diff NAME=<desc>` | Generates a new Atlas migration from Ent schema changes. |
| `make migrate-apply` | Applies pending Atlas migrations to the local database. |
| `make migrate-status` | Shows Atlas migration status against the local database. |
