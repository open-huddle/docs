---
title: "ADR 0016 — Message edit/delete + search re-keying"
sidebar_label: "0016 · Edit / delete messages"
---

# ADR 0016 — Message edit/delete + search re-keying

**Status:** Accepted
**Date:** 2026-04-23

**Resolves:** [ADR-0005](./markdown-for-message-body)'s "Out of scope: editing and deleting messages" bullet.
**Refines:** [ADR-0010](./search-service-and-indexer)'s "OpenSearch document `_id` is the outbox event UUID" decision — changed to the message UUID so edits upsert correctly.

## Context

`MessageService` has shipped Send / List / Subscribe since Phase 2, and ADR-0005 explicitly deferred edit + delete. Every subsequent product surface (search, notifications, email, invites) was built around the assumption that messages are immutable after creation. With notifications now a complete feature (ADR-0014, ADR-0015), the holes in Send-only messaging are visible: users can't fix typos, moderators can't remove abuse, and edited messages never re-index or re-notify.

This ADR lands Edit + Delete plus the downstream consumer changes they force. Three design questions, three decisions.

## Decision

### Authorization

- **Edit** — author only. An admin or owner *cannot* edit someone else's message. Editing another user's words is a compliance boundary we refuse to cross; deletion exists as the moderation primitive instead.
- **Delete** — author OR an admin/owner of the organization. The two paths have different UI affordances (own-delete is a user action, moderate-delete shows up in an audit log), but land on the same DB operation.

### Soft-delete, not hard-delete

`Message.deleted_at` stamps a timestamp instead of the row being removed. `List` and `Subscribe` filter `deleted_at IS NULL`; operators with DB access can still see the original body. This preserves the audit trail (who wrote what, who deleted it, when) and means a moderation mistake is recoverable via a direct DB UPDATE. Counter to that: the message body remains at rest after a user deletes their own content. The tradeoff is familiar (Slack, Discord, Matrix all keep deleted-by-user messages in their audit log); a future "purge" surface for GDPR right-to-erasure requests is a separate PR that hard-deletes.

### Search re-keying: `_id = message_id`, not `outbox_event_id`

ADR-0010 used the outbox event UUID as the OpenSearch document `_id` because the indexer had exactly one event type (`message.created`) and idempotency on retry was the only concern. Edits break that assumption — a `message.edited` event has a new outbox UUID, so writing it with that `_id` creates a second document instead of replacing the original.

Fix: document `_id` is the **message UUID**. `message.created` creates the doc, `message.edited` upserts over the same `_id`, `message.deleted` removes it. Idempotency on retry still holds — the create re-writes the same content, the edit re-writes the same content, the delete is a no-op on second call (404 is normalized to nil).

**Migration impact**: a running deployment has existing documents keyed by outbox event UUID. The Helm chart / deploy runbook will include a one-off reindex step on upgrade — walk every `Message` row, emit a fresh `message.created` event, let the indexer re-populate with the new `_id` scheme. Documented in the PR body. Outside this ADR's scope because it's operational, not architectural.

### Subscribe stream: unchanged this PR

`MessageService.Subscribe` currently pushes `message.created` events only. Edits and deletes fire outbox events that audit / search / notifications consume, but the ephemeral JetStream consumer feeding Subscribe does not resubscribe on the new `huddle.messages.edited.*` / `huddle.messages.deleted.*` subjects. Clients see edits on next List refetch; deletes show up as a gap.

The smaller-than-expected consequence: connected users watching a live channel see a momentary lag between the author's Save button and the edit propagating. For MVP acceptable. A future "realtime v2" PR will redesign the streaming envelope to carry an event-type enum (created/edited/deleted) in `MessageServiceSubscribeResponse`, letting clients dispatch on kind. That's a proto break so it pairs with client work — deliberately out of scope here.

### Notifications on edit: in-app only

A `message.edited` event that adds new mentions (`mention_user_ids` grew) fans out in-app Notifications for the *newly-added* recipients. The UNIQUE constraint on `Notification(recipient, message, kind)` gives the diff for free — re-inserting a `(recipient, message, mention)` tuple hits the unique and is swallowed. Existing mentions don't get re-notified.

**No email on edit**, though. The notifications table gains a `source` enum (`message_created` | `message_edited`); the mailer filters to `source = message_created` only. Rationale: the original mention already emailed the user, and adding-then-removing-then-re-adding mentions would let an abusive sender pester someone by edit cycles. In-app notifications are cheap to see and dismiss; email is not.

The `Notification.source` field is also useful for UI ("you were mentioned in an edit" shows differently from "you were mentioned").

## Alternatives considered

- **Hard-delete instead of soft-delete.** Rejected. Loses audit trail; a moderation-mistake delete is unrecoverable. Users who need true erasure should use a dedicated "purge my account" flow.

- **Admin/owner can edit others' messages.** Rejected — editing someone else's words changes what they said. Deletion is visible (the message is gone); edits are silent. Compliance-sensitive deployments would flag that as an integrity problem.

- **Keep `_id = outbox_event_id` and delete the previous doc on edit.** Considered. Two OpenSearch operations per edit (delete + create), fragile if the delete half fails. Message-ID re-keying is one operation and idempotent.

- **Email on edit when new mentions are added.** Rejected per the "abuse cycle" reasoning above. Also: a user who just got an email about the original mention opening their inbox minutes later to find a second email for the same message thread is confusing UX.

- **Proto-break Subscribe to carry event type now.** Rejected for this PR. Every client currently in the field (web + integration tests) expects `MessageServiceSubscribeResponse` to wrap a `Message`. A type-carrying redesign needs client changes in lockstep; that's the "realtime v2" PR.

- **Preserve mention set on edit (only add new; never remove existing).** Rejected. Edits replace the whole message, including mentions. A mention that's no longer in the edited body shouldn't stay "active" in the join table.

## Consequences

**Positive.**
- `MessageService` is now a complete CRUD surface. Clients can offer the standard chat-app edit/delete menus.
- Soft-delete preserves audit signal. A future compliance export can show "alice deleted this at T+15m."
- Search results stay consistent with the live message. An edit that fixes a typo fixes the search index too.
- The notifications interplay is structural — `source` on `Notification` means any future trigger kind can pick its email policy by looking at where it came from.

**Negative.**
- **Subscribe lag.** Edits and deletes don't propagate through the streaming RPC in this PR. Users connected to a live channel see a stale body until List refetch. Tracked as "realtime v2" for a future PR.
- **Re-indexing is an operational step.** Existing deployments upgrading past this ADR must reindex OpenSearch (one-off background job). The PR body carries the command; `Helm` chart migration docs will include it when we publish.
- **Deleted rows accumulate in Postgres.** No GC pass for deleted messages today. Retention is implicit: the message stays forever unless an operator truncates. Future "delete after N days of being deleted" worker is obvious but deferred.
- **Soft-delete means body is at rest.** For HIPAA / GDPR deployments that need true erasure, "delete my account" is a separate flow that hard-deletes. Noted in `compliance/data-handling`.

## Out of scope

- **Realtime v2** — Subscribe carrying edit/delete events.
- **Hard-delete for erasure** — a separate compliance flow.
- **Message version history** — "show edits" UI. The DB doesn't retain pre-edit bodies; changes overwrite the row. An audit-trail via `audit_events` keeps *event* history but not content history.
- **Delete-reason / edit-reason** — no free-form metadata on the mutation. Add when moderation workflows need it.
- **Edit time-limit** — some products lock edits after N minutes. Not imposed here; authors can edit forever. A future policy knob if operators want it.
- **Rich diffs in notifications** — "alice edited a message you're mentioned in: X → Y." Today the edit-sourced notification is bare. UX follow-up.
