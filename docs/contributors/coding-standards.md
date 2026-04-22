---
sidebar_position: 2
title: Coding standards
description: What we expect from the code you contribute.
---

# Coding standards

## Go

- Formatted with **gofumpt** and **goimports**; enforced by `make fmt`.
- Linted with **golangci-lint** (config in [`.golangci.yml`](https://github.com/open-huddle/huddle/blob/main/.golangci.yml)).
- Errors are wrapped with context (`fmt.Errorf("load config: %w", err)`).
- Logs use structured `log/slog` and never contain PII / PHI (chat bodies, tokens).
- Tests live alongside the code (`foo_test.go`). Postgres-specific behaviour (pgx error codes, `FOR UPDATE SKIP LOCKED`, FK cascades that differ from SQLite) goes in `*_integration_test.go` files behind `//go:build integration`; run them with `make test-integration` (Docker required — they spin up a shared Postgres container via `testcontainers-go`).

## TypeScript / React

- Formatted with **Prettier**; linted with **ESLint** (flat config in `apps/web/eslint.config.js`).
- TypeScript strict mode is non-negotiable; `any` is almost always wrong.
- Components in PascalCase files; hooks in camelCase prefixed with `use`.
- No direct `fetch` to the API — use the generated Connect client.

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(scope): …` — user-visible feature
- `fix(scope): …` — bug fix
- `chore(scope): …` — tooling, build, non-functional
- `docs(scope): …` — documentation only
- `refactor(scope): …` — no functional change
- `test(scope): …` — tests only
- `perf(scope): …` — performance improvement

## What to test

- **Bug fixes** must come with a regression test.
- **New features** must come with tests exercising the happy path and the failure modes you considered.
- **Compliance-impacting changes** (audit log format, PII handling, access control) require extra review and must not regress existing controls.

## What not to do

- No mocks that hide behavior that production depends on — integration tests must hit a real Postgres when they're testing Postgres behavior.
- No silent catch-and-ignore error handling.
- No logging of message contents, tokens, credentials, or session identifiers.
- No new dependencies under SSPL, BSL, or unvetted licenses — see [DEPENDENCIES.md](https://github.com/open-huddle/huddle/blob/main/DEPENDENCIES.md).
