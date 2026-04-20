---
title: "ADR 0002 — Monorepo layout"
sidebar_label: "0002 · Monorepo layout"
---

# ADR 0002 — Monorepo layout

**Status:** Accepted
**Date:** 2026-04-20

## Context

Open Huddle ships multiple artifacts — a Go API, a React web app, shared proto definitions, Helm charts, Docker Compose files — that all evolve together. We needed to decide whether each lives in its own repository or whether they live in a single monorepo.

## Decision

All production code and deployment artifacts live in a single monorepo: [`open-huddle/huddle`](https://github.com/open-huddle/huddle).

The top level is:

```text
huddle/
├── apps/
│   ├── api/       Go service (Connect-Go on chi)
│   └── web/       React + Vite + AntD
├── proto/         .proto source of truth
├── gen/           generated code, committed:
│   ├── go/        shared Go module (go.work participant)
│   └── ts/        pnpm workspace package
├── deploy/
│   ├── compose/   Docker Compose (local + small installs)
│   └── helm/      Helm charts (Kubernetes — future phase)
└── docs/          architectural notes *inside the code repo*
```

The **documentation site** (Docusaurus) lives in a separate repository ([`open-huddle/docs`](https://github.com/open-huddle/docs)) so documentation can ship at its own cadence without bloating CI on every commit to the code repo.

## Alternatives considered

- **Polyrepo (one repo per service).** Rejected — cross-cutting changes like a new proto method would require N coordinated PRs and a release ordering.
- **Monorepo with docs inside.** Rejected — documentation changes would rebuild the code CI unnecessarily, and Docusaurus deploy permissions are simpler on a dedicated repo.

## Consequences

- One PR can touch proto, server, and client together — which is how refactors usually happen.
- Generated code is committed so contributors don't need `buf` to build.
- The workspace boundary is explicit: `pnpm-workspace.yaml` for Node, `go.work` for Go.
