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

This starts PostgreSQL and Valkey via Docker Compose. Stop them with `make dev-down`.

## Run the API

```bash
make api-run
```

The API listens on `:8080` by default. It serves:

- `POST /huddle.v1.HealthService/Check` — the Connect-Go health RPC.
- `GET /livez` — Kubernetes liveness probe.
- `GET /readyz` — Kubernetes readiness probe.

Verify it's up:

```bash
curl -X POST http://localhost:8080/huddle.v1.HealthService/Check \
  -H "Content-Type: application/json" \
  -d '{}'
# {"status":"STATUS_SERVING","version":"dev"}
```

## Run the web app

In a separate terminal:

```bash
make web-run
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/huddle.v1/*` to the API on `:8080`, so the health card should render "serving".

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
