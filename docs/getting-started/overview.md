---
sidebar_position: 1
title: Overview
description: A tour of the Open Huddle repository and how the pieces fit together.
---

# Getting started

This section walks you through the project at a high level, then gets a local environment running on your machine.

## Repository layout

Open Huddle lives in two repositories:

| Repository | What it contains |
|---|---|
| [`open-huddle/huddle`](https://github.com/open-huddle/huddle) | The monorepo: Go API (`apps/api`), React web app (`apps/web`), shared proto definitions (`proto/`), generated code (`gen/`), Helm charts and Docker Compose files (`deploy/`). |
| [`open-huddle/docs`](https://github.com/open-huddle/docs) | This documentation site (Docusaurus). |

## How the pieces fit

A minimal deployment runs:

- **`apps/api`** — Go service built on `net/http` + chi + Connect-Go. Exposes the RPC surface defined in `proto/` as REST + gRPC + gRPC-web from a single `.proto` file.
- **`apps/web`** — React + Vite + TypeScript + Ant Design. Speaks the same Connect protocol from the browser.
- **PostgreSQL** — authoritative store for users, channels, messages, audit log.
- **Valkey** — presence, ephemeral session state, rate limits.
- **Keycloak** — identity (OIDC / SAML / LDAP, MFA, SSO).
- **LiveKit** — SFU for voice and video calls.
- **NATS JetStream** — internal event bus; every write emits an event consumed by search, notifications, and audit-log services.

For the full list and the licensing story behind each component, see the [stack](../architecture/stack).

## Next step

Follow the [local development guide](./local-development) to bring the stack up on your machine in a few minutes.
