---
title: "ADR 0017 — Realtime v2: Subscribe event envelope"
sidebar_label: "0017 · Realtime v2"
---

# ADR 0017 — Realtime v2: Subscribe event envelope

**Status:** Accepted
**Date:** 2026-04-23

**Refines:** [ADR-0006](./connect-streaming-for-realtime) — replaces its "Subscribe streams new `Message`s" wire shape with a oneof envelope carrying creates, edits, and deletes.
**Closes:** [ADR-0016](./message-edit-delete) — Subscribe-stays-unchanged was called out as the one rough edge in Edit/Delete; this ADR sands it off.

## Context

`MessageService.Subscribe` launched in Phase 2c as a create-only fan-out: the server streamed a `Message` proto on every send, clients rendered the new row into their UI. Phase 2c was before edit/delete existed, so the "only creates" shape was fine.

Edit/delete landed in ADR-0016 with a deliberate scope cut: the streaming RPC would not carry them in that PR. Clients could see edits via List refetch. That was the right call for a single-feature PR, but it leaves connected users seeing stale bodies and tombstoned messages that should have disappeared. This ADR removes the shortcut by redesigning the wire envelope.

Two design questions shape the decision:

1. **How to carry mixed event types on a single stream?** Protobuf's `oneof` is the textbook answer but it's a wire-break. Three-optional-fields is backward-compat but less idiomatic.
2. **How to handle the proto-break in CI?** `buf breaking` will flag it no matter what; we need to either exempt the rules (targeted, temporary) or bump the package to v2 (broad, permanent churn).

## Decision

### One stream, three oneof variants

`MessageServiceSubscribeResponse` carries a `oneof event` with three variants:

```proto
message MessageServiceSubscribeResponse {
  oneof event {
    MessageCreatedEvent created = 1;
    MessageEditedEvent edited = 2;
    MessageDeletedEvent deleted = 3;
  }
}
```

- `MessageCreatedEvent { Message message }` — full Message proto, same body that `Send` populates.
- `MessageEditedEvent { Message message }` — same shape, but the Message carries `edited_at` set.
- `MessageDeletedEvent { string message_id, string channel_id }` — just identifiers; the body has been soft-deleted upstream.

Clients switch on the populated variant. New variants land by adding entries to the oneof — a minor extension, not a break.

### NATS subscriber: one consumer, wildcard subject

`events.NATS.SubscribeMessages` creates a single ephemeral JetStream consumer filtered on `huddle.messages.*.<channel_id>`. The `*` segment matches `created`, `edited`, and `deleted`. The consumer's message handler inspects the arriving subject, derives the `MessageEventKind`, decodes the payload, and emits on the generalized `<-chan *MessageEvent` the handler consumes.

One wildcard consumer (not three per-verb consumers) because:
- JetStream per-consumer cost is non-trivial; fan-in at the subject level is cheaper.
- Ordering across create / edit / delete for the same message is preserved by the single consumer.
- The `InactiveThreshold` self-cleanup story from ADR-0007 still applies uniformly.

### Wire-break handling

`buf breaking` flags four rules for the oneof replacement: `FIELD_SAME_JSON_NAME`, `FIELD_SAME_ONEOF`, `FIELD_SAME_TYPE`, `FIELD_SAME_NAME`. They're all expected — the field at tag 1 changed from a singular `Message` to a `MessageCreatedEvent` inside a oneof.

We use `buf.yaml`'s `breaking.ignore_only` to exempt these specific rules for `proto/huddle/v1/message.proto` once, with a comment calling out that the exemption becomes dead config after this PR lands on main (the new shape then becomes the diff baseline, and a follow-up PR removes the ignores). Package-version bumping to `v2` was considered and rejected — it's broad churn for every RPC in the package, most of which aren't changing.

## Alternatives considered

- **Three-optional-fields envelope, no oneof.** Wire-compatible — old clients receiving an edit see `created = nil, edited = <filled>` and quietly ignore it. Rejected because: (a) clients still need to branch on which field is set, so the semantic ergonomics are identical to a oneof, (b) reinventing oneof at the field level is less idiomatic, (c) the pre-alpha wire break has zero blast radius (web client doesn't consume Subscribe yet).

- **Bump the proto package to `huddle.v2`.** Rejected. `huddle.v1` has ~6 services beyond `MessageService`, none of which are changing. A package bump would require renaming every import + regenerating all clients for a surface that's already correct. The one-RPC wire break is more surgical.

- **Separate streams per event type (`SubscribeCreates`, `SubscribeEdits`, `SubscribeDeletes`).** Rejected. Triples the connection count, fragments the ordering guarantees between kinds (edit for message X before delete for X? needs coordination), and doesn't match the "one chat stream per channel" mental model clients have.

- **Keep Subscribe carrying only creates; add a separate `SubscribeMutations` RPC for edits + deletes.** Considered. Would avoid the wire break entirely. Rejected because: (a) two streams per channel per client doubles the JetStream consumer footprint for no real gain, (b) splitting by "kind of mutation" is an internal-architecture division that shouldn't leak into the RPC surface.

- **Drop server-side filtering and push every channel's events, let the client filter.** Rejected on principle — authz is a server concern, and a client that subscribes to channel A should not be able to sniff channel B's events by filter evasion. The per-channel subject + per-channel consumer model survives.

## Consequences

**Positive.**
- Connected clients see edits and deletes live. Chat UX matches peer products (Slack, Discord, Matrix).
- The oneof envelope is extensible. Future control frames — `HeartbeatEvent`, `TypingEvent`, `ReactionAddedEvent` — land as additional oneof variants without a further wire break.
- One JetStream consumer per subscription, not three. Server footprint stays linear with subscription count.
- Ordering between create / edit / delete for the same message is preserved by the single consumer. A client that sees `created` then `edited` then `deleted` for message M will render the sequence correctly; JetStream's in-subject ordering guarantees it (outbox publisher writes in strict serial order).

**Negative.**
- **Proto break in this PR.** Anyone who had already generated a client against the old `MessageServiceSubscribeResponse` will get decode errors. Mitigation: the project is pre-alpha, no external consumers exist, and the web app's generated client will regenerate cleanly from the new proto.
- **`buf.yaml` ignores are dead config after merge.** We're adding four targeted ignores that the first post-merge PR should prune. Tracked via a comment in `buf.yaml` pointing at this ADR.
- **Subject wildcard has no backpressure per-verb.** If a chatty author fires 100 edits/second on one message, the stream gets hit with 100 `edited` events. Client needs to debounce. No rate limit on the server side today.
- **Unknown-kind events are silently dropped.** The consumer's `kindFromSubject` returns `MessageEventUnknown` for unrecognized subjects; the handler's `buildSubscribeResponse` errors; the handler's caller logs and continues. A future control-frame kind added to NATS but not to the Go enum would be invisible to Subscribe until the code updates — explicit by design (don't ship a half-parsed frame to clients) but worth calling out.

## Out of scope

- **Backfill / catch-up on reconnect.** Subscribe still starts at "now"; clients are responsible for List-based reconcile. A future PR may add a `since_cursor` parameter.
- **Typing indicators / presence on this stream.** Same envelope pattern would fit, but those features aren't built yet and would change the server-side subscriber's filter.
- **Per-event retry / delivery guarantees.** Subscribe is still best-effort fan-out (ADR-0007); the authoritative store is Postgres.
- **Removing the `buf.yaml` ignores.** Separate follow-up PR once this merges; noted in the `buf.yaml` comment.
- **Client heartbeat / keepalive frames.** Useful for long-lived streams behind load balancers that idle-close; not needed for the local dev path and deferred.
