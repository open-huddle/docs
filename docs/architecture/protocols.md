---
sidebar_position: 3
title: Protocols
description: How clients and services talk to each other on the wire.
---

# Protocols

Open Huddle uses three protocols intentionally, not by accident:

| Traffic | Protocol | Why |
|---|---|---|
| Browser ↔ backend (request-response) | **Connect** (REST + gRPC + gRPC-web from one `.proto`) | Browsers can't speak native gRPC; Connect gives us one `.proto` and three wire formats without dual maintenance. |
| Browser ↔ backend (realtime) | **WebSockets** | Chat messages, typing, presence, call signaling — long-lived bi-directional streams. |
| Service ↔ service (internal) | **gRPC** via Connect-Go | Strongly typed, streaming-capable, already have the generated code from the same proto. |

## Client-to-server (Connect)

Every RPC defined in `proto/huddle/v1/*.proto` becomes reachable as:

- a JSON REST endpoint — `POST /<package>.<Service>/<Method>`
- a binary gRPC endpoint — same path, `application/grpc`
- a gRPC-web endpoint — same path, `application/grpc-web`

Browsers use gRPC-web or JSON. Native clients and internal services use native gRPC.

## Authentication

All RPCs are protected by a Connect interceptor that validates a JWT from Keycloak. The token is carried:

- over HTTPS in the `Authorization: Bearer …` header for Connect / gRPC
- over the WebSocket handshake for long-lived connections

The API does not issue its own tokens. Identity is always Keycloak.

## Realtime (WebSockets)

One WebSocket connection per client. Multiplexed frames carry:

- new messages for the channels the user subscribes to
- typing and presence updates
- WebRTC signaling for calls (offer / answer / ICE)

The WebSocket path is outside the Connect RPC surface so load balancers and WAFs can treat it separately.

## Internal (gRPC)

Service-to-service traffic is plain gRPC over mTLS. Linkerd injects sidecars that handle certificate rotation — application code never touches TLS material.
