---
title: "ADR 0006 — Connect server-streaming for realtime"
sidebar_label: "0006 · Connect streaming for realtime"
---

# ADR 0006 — Connect server-streaming for realtime

**Status:** Accepted
**Date:** 2026-04-20

**Supersedes:** the realtime guidance in [Protocols](../architecture/protocols) prior to this ADR, which described raw WebSockets.

## Context

Phase 2c added live message delivery: when one client sends to a channel, every other connected client subscribed to that channel must see the message within milliseconds. We had to decide what wire-level shape that subscription takes.

The repository's [original Protocols page](../architecture/protocols) committed to raw WebSockets ("one WebSocket connection per client; multiplexed frames carry new messages, presence, signaling"). The Phase 2c implementation revisited that decision in light of what the rest of the system actually does.

## Decision

Realtime delivery uses **Connect server-streaming RPCs over HTTP/2**, not raw WebSockets. The first one shipped is `MessageService.Subscribe(channel_id) returns (stream Message)`. Future realtime surfaces (typing indicators, presence, call signaling) follow the same pattern: a streaming RPC defined in the same `.proto` files, served by the same `apps/api`, authenticated by the same Connect interceptor.

Concretely:

- Server wraps the chi router in `h2c.NewHandler`, so the API speaks HTTP/2 in cleartext (`h2c`) end-to-end. TLS is the mesh's job.
- The Connect auth interceptor implements the full `Interceptor` interface — `WrapUnary`, `WrapStreamingClient` (no-op for our server-side use), and `WrapStreamingHandler`. Streaming RPCs go through the same Bearer-token path as unary; tokens are verified once at stream open.
- Browser clients consume via Connect-ES; native clients via Connect-Go; internal services via plain gRPC. The `.proto` file is the single source of truth for all three.

## Alternatives considered

- **Raw WebSocket on a chi route, multiplexing application frames.** Rejected. It would mean a separate auth path (parse the upgrade request rather than a Connect interceptor), separate codegen (no proto-driven message shapes), separate observability (instrument the WebSocket separately from RPC latency), and a custom framing protocol on top. All to gain bidirectionality we don't need yet.

- **Server-Sent Events (SSE).** Rejected. SSE is server-to-client only and never made it past niche use. It would not handle future bidirectional needs (typing, signaling) cleanly and adds a third protocol on the surface area.

- **gRPC streaming directly (no Connect wrapping).** Rejected. Browsers cannot speak native gRPC; we would need a separate gRPC-web shim or a JSON REST equivalent, which is exactly the dual-maintenance problem [ADR-0003](/adr/connect-rpc-over-plain-grpc) ruled out.

## Consequences

**Positive.**
- One protocol surface. Same `.proto`, same generated clients, same auth interceptor, same observability hooks.
- Token verification happens through the existing `auth.NewInterceptor` rather than a parallel implementation parsing WebSocket upgrade headers. Less code, fewer places to get auth wrong.
- Reconnects are HTTP/2 streams — load balancers, WAFs, and gateways already understand them.
- Future bidirectional needs (typing, call signaling) can use Connect's bidi-streaming, still through the same proto.

**Negative.**
- HTTP/2 is required end-to-end. The server uses `h2c`; clients must speak HTTP/2 (Connect-ES does). HTTP/1.1-only intermediaries between the client and the API would break streaming. Acceptable in self-hosted deployments where the operator controls the path.
- Browser bidi-streaming over HTTP/2 has known constraints relative to true WebSockets (no half-close pattern that some browsers handle differently). Not a problem for what we ship today; revisit if a future use case actually needs full-duplex.
- Connect server-streaming over HTTP/1.1 uses chunked transfer encoding, which works but is less efficient than HTTP/2. We default to HTTP/2; HTTP/1.1 is a fallback, not a target.

## Implementation notes

- `apps/api/internal/auth/interceptor.go` implements the full `Interceptor` interface. **Do not use `connect.UnaryInterceptorFunc`** for cross-cutting interceptors — it silently bypasses streaming handlers. This bit us during Phase 2c verification and is the single most important pattern to remember when adding new streaming RPCs.
- The handler returns `nil` when the upstream channel closes (server shutdown or broker disconnect) and propagates the error from `stream.Send` (most often a broken pipe — client went away). Connect maps the latter to the right transport state.
- See [ADR-0007](/adr/event-broker-from-day-one) for the broker that backs the streams.
