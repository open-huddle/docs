---
title: "ADR 0013 — Email invitations and the email abstraction"
sidebar_label: "0013 · Email invitations"
---

# ADR 0013 — Email invitations and the email abstraction

**Status:** Accepted
**Date:** 2026-04-23

## Context

Phase 1c shipped `OrganizationService.AddMember(organization_id, user_id, role)` — a low-level admin primitive that assumes the target user already exists. The human-facing "invite someone by email who may not have an account yet" flow was explicitly deferred. Enough infrastructure now sits behind the outbox + audit pipeline that shipping invites without the email subsystem wouldn't be a meaningful increment: the notifications consumer queued up next also needs an email pipe, so closing both together avoids rework.

Two concerns shape the design beyond "send an email":

1. **Token handling.** The invite URL needs to carry a one-time secret. That secret must be verifiable by the API at accept time and must not leak into artifacts with longer retention (audit events, search projections, analytics). We decided on HMAC-SHA256 of a 32-byte random token with a server-side secret — see the "token storage" section below for why bcrypt / argon2 / plaintext lookup were rejected.
2. **Where the plaintext lives.** Outbox consumers (audit) mirror the event payload into their own rows. If the plaintext token rides in the outbox event, it ends up in `audit_events` too — a compliance-retention row that would then contain a live secret. The pattern elsewhere in the project ([ADR-0009](./transactional-outbox-and-audit-consumer)) is "audit is the denormalized survivor of GC"; audit holding secrets directly contradicts that.

## Decision

### Token flow

- **Minting.** `InviteMember` generates a fresh 32-byte token via `crypto/rand`, stores its HMAC-SHA256 hash (keyed with a server-wide `invites.secret`) in `invitations.token_hash`, and also persists the plaintext in a short-lived `invitations.token_plaintext` column. The plaintext only needs to survive until the mailer has delivered the email.
- **Delivery.** `internal/invitations.Mailer` — a fifth in-process worker — polls `invitations` where `email_sent_at IS NULL AND expires_at > now() AND accepted_at IS NULL`, renders the email (including the accept URL with the plaintext token), hands it to `email.Sender.Send`, records the outcome as an `EmailDelivery` row, then stamps `email_sent_at` and clears `token_plaintext` on success. Uses `SELECT ... FOR UPDATE SKIP LOCKED` on Postgres for the same multi-replica claim story as the publisher and indexer ([ADR-0012](./skip-locked-outbox-claim)).
- **Verification.** `AcceptInvitation` HMACs the provided token with the same server secret, looks the invitation up by `token_hash`, checks that it is neither expired nor already accepted, and — critically — that the caller's OIDC email matches `invitations.email` (case-insensitive). Forwarding an invite email to a third party does not let them take the slot; Keycloak-verified signup is the binding.
- **Outbox event.** Every InviteMember also enqueues an outbox event `invitation.created`. The payload is the Invitation proto **without** the token (neither plaintext nor hash). Audit mirrors this payload; the mailer ignores it. The event exists so future consumers (notifications dashboards, compliance exports) can read every invite lifecycle change without joining back to the Invitation table.

### Where plaintext lives

Plaintext token is stored on the `Invitation` row, not in the outbox event payload. Lifetime at rest is bounded by the mailer's poll cadence — a few seconds in steady state, up to one tick on a bad first attempt. The mailer clears it on success; AcceptInvitation also clears it as belt-and-braces in case the mailer never got there (e.g. the invitee acquired the token out of band).

The explicit consequence: `audit_events.payload` for `invitation.created` events never contains a live secret, so the compliance trail can keep its long retention without a redaction pipeline.

### The email abstraction

- **`email.Sender` interface** — one method `Send(ctx, Message) error`. Single recipient per Message, plain text only in this PR (HTML lands with the broader notifications work).
- **`email.LogSender`** writes the rendered email to the structured logger. Dev default — a contributor runs `make dev-up`, does a full invite round-trip via `buf curl`, and reads the email body out of the API log. No SMTP plumbing required to exercise the flow.
- **`email.SMTPSender`** dials a classic submission-port relay (default 587), supports STARTTLS, uses net/smtp's PLAIN auth. Connection-per-send (no pooling) — invite volume is low and short-lived connections keep credentials out of long-lived process memory.
- **Factory is in `cmd/api/main.go`** — picks the Sender based on `email.driver` config (`log` or `smtp`), fails fast on SMTP misconfig.

### Outbox GC precondition, and the indexer change that goes with it

`outbox.GC` already required `published_at`, the `audit_events` sibling, and `indexed_at` to all be set before deletion ([ADR-0011](./outbox-gc-and-audit-decoupling)). The indexer only stamped `indexed_at` for `message.created` events — a latent bug that never fired because there were no other event types. `invitation.created` is the first; without a fix, every invite event would live in the outbox forever.

Fix: the indexer now polls all un-indexed rows and stamps `indexed_at` on every row it evaluates, whether it indexes it (message.created) or deliberately skips it (everything else). Semantically `indexed_at` means "the search indexer has finished with this row," not "this row got indexed."

## Alternatives considered

- **bcrypt / argon2 instead of HMAC for the at-rest token.** Rejected. The token is already 32 bytes of crypto randomness — brute-forcing it over the token space is computationally infeasible regardless of how slow the hash is. Bcrypt's value proposition (slow hashing against weak inputs) is irrelevant here, and its cost shows up as slow invite acceptance. HMAC with a server-side secret achieves the same "DB dump alone is insufficient to recompute token→hash" property more efficiently.

- **Plaintext tokens in the outbox event payload.** Rejected. The mailer would be a cleaner pure-outbox consumer, but the payload travels into `audit_events` via the audit consumer — which means a live secret sits in a table with compliance-retention scope. Adding a redaction layer to the audit consumer for this one event type defeats the "audit is a plain mirror of outbox" invariant.

- **Encrypt the token in the outbox payload; only the mailer holds the key.** Rejected as over-engineered. It would let the mailer read the outbox instead of the Invitation table — which looks architecturally prettier — but the cost is a symmetric encryption story the project does not otherwise need, and an audit row holding ciphertext is still morally carrying a secret. Keeping plaintext on the Invitation row for seconds, and having the mailer read that row directly, is simpler.

- **Separate `InvitationToken` table that the mailer reads.** Rejected. One-to-one with Invitation would duplicate the row, and the lifecycle (create → delete) offers no win over a nullable column that gets cleared. A separate table is useful when different rows need different retention; the token lives exactly as long as the Invitation, so same-row is correct.

- **No email ownership check at accept time.** Rejected. Forwarded emails would allow hijacking — a real risk for password-reset-style flows, not just theoretical. The Keycloak-signup + email-matches-invite pairing is the canonical SaaS invite shape (GitHub, Slack, Vercel).

- **Send email synchronously from `InviteMember`.** Rejected. The handler would block on SMTP latency, which is unpredictable. A background mailer preserves invite latency, makes retry natural (polling keeps trying until delivered or expired), and decouples the request path from broker state. Also matches the pattern from the other outbox-adjacent workers (publisher, audit, indexer, GC).

## Consequences

**Positive.**
- The email pipe is now a real component of the stack, usable by the future notifications consumer without further plumbing.
- Audit rows never carry live invite tokens. The compliance-retention story ([ADR-0009](./transactional-outbox-and-audit-consumer), [ADR-0011](./outbox-gc-and-audit-decoupling)) continues to hold as more event types land.
- Dev UX is frictionless: `make dev-up` + `HUDDLE_EMAIL_DRIVER=log` (the default) means no SMTP config needed to exercise the full invite flow.
- The indexer fix closes a latent GC starvation bug that would have bitten us the first time we added any non-message event type.

**Negative.**
- Plaintext tokens sit at rest for seconds (up to one mailer tick on the happy path). Documented; operators who want stricter can shorten `invites.ttl` and the mailer poll interval. True plaintext-never-at-rest would require synchronous send, which trades a larger correctness problem for a smaller secret-lifetime one.
- `invites.secret` is now a mandatory per-deployment rotation decision. Rotating it invalidates every outstanding pending invitation — by design, but operators must understand it.
- Connection-per-send SMTP is less efficient than pooled send. Invite volume doesn't justify the pool today; revisit if notifications inflates volume 1000x.
- Adding the fifth background worker pushes `apps/api` further into the "doing a lot of things in-process" territory. Once Debezium CDC lands, splitting the workers into their own binary becomes feasible; for now the single-process model trades operational simplicity for scale.

## Out of scope

- **HTML email / templates.** Plain text only in this PR; a templated HTML path lands alongside richer notifications.
- **`ListInvitations` / `RevokeInvitation` admin surface.** Admins have to re-invite to rotate tokens in the MVP. Full admin CRUD is one small follow-up PR.
- **Invitation GC.** Expired and accepted invitations pile up indefinitely for now. A separate retention policy (e.g. delete 90 days after terminal state) will land with the admin surface above.
- **Bounce handling.** The mailer currently records SMTP errors but doesn't parse bounces from the relay. Hard-bounce-triggered revocation is a future PR; today's failure mode is "the invitee re-requests."
- **Audit-event ingestion pipeline for notifications.** The `invitation.created` event is in the outbox for future consumption; the notifications consumer that'll fan out dashboard alerts is a separate PR.
- **MLS / E2E encryption interplay.** Invitations happen pre-channel, so there's nothing to encrypt in the invite flow itself. A future MLS ADR may add device-trust onboarding steps, not invite-flow changes.
