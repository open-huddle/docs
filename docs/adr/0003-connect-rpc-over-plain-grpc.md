---
title: "ADR 0003 — Connect RPC over plain gRPC"
sidebar_label: "0003 · Connect over gRPC"
---

# ADR 0003 — Connect RPC over plain gRPC

**Status:** Accepted
**Date:** 2026-04-20

## Context

Open Huddle needs to expose the same service surface to a browser client and to internal services. Browsers cannot speak native gRPC — they can speak gRPC-web (with a proxy) or REST+JSON. Maintaining two definitions (proto for services, OpenAPI for browsers) is a well-known tax.

## Decision

Use the **Connect protocol** as the client-facing RPC layer, backed by **Connect-Go** on the server and **Connect-ES** in the browser. One `.proto` file defines every method; Connect's generator produces REST (JSON), gRPC, and gRPC-web from it. Internal services can keep speaking native gRPC because Connect-Go handlers accept all three.

## Alternatives considered

- **Native gRPC + a separate REST / OpenAPI layer.** Rejected — dual maintenance, skew risk, extra translation layer.
- **GraphQL.** Rejected — adds a query language we don't need, and pagination / streaming semantics are less natural than gRPC streaming.
- **Plain REST + JSON.** Rejected — loses the strong schema contract, forces hand-written clients, and makes internal service-to-service streaming awkward.
- **gRPC-web with a standalone proxy (Envoy).** Rejected — Connect-Go does this in-process without a sidecar; fewer moving parts for self-hosters.

## Consequences

- Browser clients make JSON or gRPC-web calls to the same endpoints; Go clients make native gRPC calls to the same endpoints.
- One generator pipeline (`buf generate`) produces every client.
- If we ever need protocol flexibility beyond Connect (e.g. WebTransport), we can add it without re-architecting.
