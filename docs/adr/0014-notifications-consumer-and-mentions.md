---
title: "ADR 0014 — Notifications consumer and the mention model"
sidebar_label: "0014 · Notifications + mentions"
---

# ADR 0014 — Notifications consumer and the mention model

**Status:** Accepted
**Date:** 2026-04-23

**Resolves (from ADR-0005):** the "mentions become a separate field" commitment ADR-0005 made but deferred. This ADR lands that field + the join table + the consumer that fans out on it.

## Context

ADR-0005 committed to keeping the Message body as opaque Markdown and moving structured concerns (mentions, attachments, threads, reactions) to separate proto fields / entities as they land. Mentions are the first such concern with a concrete use case: the notifications inbox. Without mentions, there is no trigger for a notification; without notifications, mentions have nowhere to go.

Phase 3b-1 (search) and the email-invites PR shipped the general shape — an outbox row per event, one or more background consumers that polls and fans out — four times. Notifications is the fifth. The design questions now are narrower: what does the mention set look like on the wire, where does it live at rest, and how does the consumer avoid duplicate Notifications under restart and SKIP LOCKED concurrent claim.

## Decision

### Mention model

- **Wire shape:** `MessageServiceSendRequest.mention_user_ids []string`. `MessageService.Send` validates every id is a member of the channel's organization, de-dupes the set, and silently drops self-mentions. Non-member mentions return `InvalidArgument` — the sender cannot ping strangers through the invitation side-channel.
- **At rest:** a dedicated `message_mentions` join table (`message_id`, `user_id`, UNIQUE on the pair). Separate from `messages.body` because (a) ADR-0005 already rejected body parsing, (b) the "messages mentioning user X" lookup is a first-class path, (c) mentions are immutable alongside the message — editing (ADR-0005 deferred) will be a separate design call.
- **Outbox payload:** the `Message` proto now carries `mention_user_ids []string`, which is what the outbox payload serializes. The consumer decodes the payload to fan out; there is no second query against the join table at consume time.

### Notification entity

One row per `(recipient, message, kind)` — UNIQUE on that triple is the idempotency guard under consumer restart or concurrent replica racing. `kind` is `enum("mention")` today; new kinds (DMs, reactions, thread replies, system) land as features that produce them. Denormalized `organization_id` + `channel_id` on the Notification row mean List queries don't have to traverse Message → Channel → Organization just to scope the inbox.

### Consumer

`internal/notifications.Consumer` — sixth in-process worker. Polls outbox rows where `notified_at IS NULL`, in batches, under `FOR UPDATE SKIP LOCKED` on Postgres. For each `message.created` row, decodes the payload, and for each mention calls `tx.Notification.Create(...)`. UNIQUE violations on retry / race are swallowed and logged (benign by design). Non-message event types are stamped without work — same pattern as the indexer after the ADR-0013 latent-bug fix. Stamps `notified_at` at the end of the tx so `outbox.GC` can eventually reap.

### GC predicate extension

`outbox.GC` now requires **four** markers before deleting a row:
`published_at IS NOT NULL AND indexed_at IS NOT NULL AND notified_at IS NOT NULL AND HasAuditEvent()`.
The pattern set by ADR-0011 holds: every new consumer that processes an outbox row must leave a marker, and GC only fires when every known consumer is done.

### Authorization

`NotificationService.List` / `MarkRead` are strictly per-recipient: every query and mutation is scoped by `recipient_user_id == caller.ID`. There is no `policy.Engine` call — the data model is the authz boundary. `MarkRead` on a notification owned by another user returns `NotFound` rather than `Forbidden`, so callers cannot confirm the id's existence.

## Alternatives considered

- **Parse mentions out of the body at send time.** Rejected. ADR-0005 already closed this — the server would have to understand Markdown dialects, `@username` resolution rules, and eventual MLS encryption would make the server blind anyway. Keeping mentions as explicit ids is what that ADR bought.

- **JSON array column on `messages` instead of a join table.** Rejected. The lookup path the notifications consumer uses (decode payload → mention ids) works either way, but the future "my mentions across the whole app" UI needs `user_id` indexed, which a JSON array can't provide without functional indexes. Join table is the right cost.

- **Fan out synchronously from `MessageService.Send`.** Rejected. Would inflate send latency with N Notification inserts (one per mention) inside the request transaction, plus extend the blast radius of a bad mention set. The consumer pattern decouples `Send` latency from downstream work, matches the shape already in use for audit / search / invites, and makes retry a function of polling.

- **Per-consumer watermark table instead of a column on OutboxEvent.** Considered; deferred. A `consumer_checkpoints` table with `(consumer_name, last_processed_outbox_id)` scales better than adding a column per consumer. But the cost of the current pattern at N=4 consumers is a single nullable timestamp column and one predicate term on GC — lower operational complexity than a new entity + cursor management. Revisit when N=8 or when a consumer legitimately needs to process rows out of insertion order.

- **Store read_at as a separate `NotificationRead` table.** Rejected. A column is one `UPDATE ... SET read_at = now()` vs a table that's one `INSERT` and a LEFT JOIN on every List. The "read" state is intrinsic to the notification; a separate table is right only if reads carry metadata (who read it, from which device, etc.) — which we don't have.

## Consequences

**Positive.**
- Notifications are a real feature. The inbox surface (`List`, `MarkRead`) is live, backed by persisted rows.
- The mention model is stable enough to underpin future triggers: thread replies, reactions, and DMs will all emit `message_mentions`-like join rows (or their own equivalents) and produce Notifications through the same consumer.
- The outbox-consumer pattern has now proven out across four consumers (audit, indexer, mailer, notifications). The shape — tx-wrapped poll, SKIP LOCKED on Postgres, stamp-on-every-row-you-evaluate — is the house style.
- Mentions are indexable without adding to the OpenSearch mapping. The future "search messages that mention me" surface will query `message_mentions` directly, bypassing OpenSearch for an exact-user filter.

**Negative.**
- `outbox.GC`'s predicate now has four terms. One more means one more condition reviewers have to remember to extend when a new consumer lands. The pattern is explicit (ADR-0011), but it's operational debt.
- In-app only in this PR. Users see notifications when they open the app; nothing buzzes their inbox. Email-on-mention is the natural next PR — tiny in scope because `email.Sender` (ADR-0013) is already there, and the only missing piece is a `notifications.EmailMailer` that reads un-emailed notifications and sends via the same pipe.
- No notification preferences. Every mention produces a Notification; no way to opt out per channel or per kind. The `NotificationPreference` entity lands alongside email (the first place a preference makes sense).
- Message deletion (ADR-0005 deferred) will have to decide what happens to existing Notifications pointing at the deleted message. Schema today: `message_id` is optional on Notification; the FK is nullable/`SET NULL` on delete. The notification survives as a ghost of the mention that was.

## Out of scope

- **Email-on-mention.** Next PR. `notifications.EmailMailer` + a `Notification.emailed_at` column + a `NotificationPreference` per-user toggle for "email me when I'm mentioned."
- **Thread replies / reactions / DMs** as notification triggers. Each lands as its own entity; this ADR's consumer is the template.
- **Push / web-push / desktop notifications.** Outside the scope of the email-first delivery pipe; a future transport.
- **Notification grouping.** "5 new mentions in #general" as a single UI entry rather than 5 rows. Client-side concern for now; backend returns the rows one-per-mention.
- **Notification GC / retention.** Notifications pile up indefinitely today. A retention worker — delete read notifications older than N days — lands with the admin UI.
- **Cross-organization notifications.** Today every Notification belongs to exactly one organization (the UNIQUE constraint includes it as a prefix on indexes). Future federation / cross-org mentions will need a broader shape.
