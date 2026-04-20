---
sidebar_position: 3
title: Protocols
description: How clients and services talk to each other on the wire.
---

# Protocols

Open Huddle uses two protocols intentionally, not by accident:

| Traffic | Protocol | Why |
|---|---|---|
| Client ↔ backend (request-response **and** realtime) | **Connect** over HTTP/2 — REST, gRPC, gRPC-web, and server-streaming all from one `.proto` | Browsers can't speak native gRPC; Connect gives us one `.proto` and three wire formats without dual maintenance. Server-streaming over HTTP/2 means realtime uses the same auth header, the same generated client, and the same observability path as unary RPCs. |
| Service ↔ service (internal) | **gRPC** via Connect-Go | Strongly typed, streaming-capable, already have the generated code from the same proto. |

## Client-to-server (Connect)

Every RPC defined in `proto/huddle/v1/*.proto` becomes reachable as:

- a JSON REST endpoint — `POST /<package>.<Service>/<Method>`
- a binary gRPC endpoint — same path, `application/grpc`
- a gRPC-web endpoint — same path, `application/grpc-web`

Browsers use gRPC-web or JSON. Native clients and internal services use native gRPC.

## Authentication

All RPCs except the public health surface are protected by a Connect interceptor that validates a JWT from Keycloak. The token is carried in the `Authorization: Bearer …` header for both unary and streaming calls, and is verified once at stream open. Long-lived clients reconnect periodically with a fresh token.

The API does not issue its own tokens. Identity is always Keycloak.

## Realtime

Realtime delivery uses **Connect server-streaming RPCs over HTTP/2**, not raw WebSockets. The first one shipped is `MessageService.Subscribe(channel_id)`, which streams new messages in a channel as they are sent. Future streaming RPCs (typing indicators, presence, call signaling) follow the same pattern.

The rationale — same proto / auth / codegen path as everything else, no separate WebSocket stack to maintain, browser-capable via Connect-ES — is documented in [ADR-0006](/adr/connect-streaming-for-realtime).

Underneath, sends publish to **NATS JetStream** on `huddle.messages.created.<channel_id>`; the streaming handler creates an ephemeral JetStream consumer and forwards events to the client. See [ADR-0007](/adr/event-broker-from-day-one) for why the broker is in place from Phase 2c rather than waiting until horizontal-scale forces the issue.

## Internal (gRPC)

Service-to-service traffic is plain gRPC over mTLS. **Linkerd** injects sidecars that handle certificate rotation — application code never touches TLS material, and never re-verifies caller identity in code. The mesh is the source of truth for east-west authentication; the API stops verifying tokens at the edge.

Authorization (e.g. "User X is a member of Org Y, so they may read this channel") is still an app concern — the mesh cannot know that — and lives at the handler level. See [ADR-0008](/adr/handler-level-authorization).
