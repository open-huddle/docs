---
title: "ADR 0015 — Notification email delivery and preferences"
sidebar_label: "0015 · Notification emails"
---

# ADR 0015 — Notification email delivery and preferences

**Status:** Accepted
**Date:** 2026-04-23

**Refines:** [ADR-0014](./notifications-consumer-and-mentions) — resolves its "Email-on-mention" out-of-scope bullet and the "preferences land alongside email" commitment.

## Context

ADR-0014 shipped the in-app notifications inbox but deliberately stopped before email delivery, for two reasons: the email abstraction ([ADR-0013](./email-invitations-and-email-abstraction)) was still load-bearing for a single consumer, and the preference-model design didn't have a second kind to generalize against. One PR later the invitation mailer is stable and the pattern is worth the second customer. This ADR covers the email-on-mention flow + the per-user preferences that govern it.

The design questions are narrow:

1. **Default state** for a user who has never touched preferences: opt-in (silent until toggled on) or opt-out (emails until toggled off)?
2. **Preference granularity**: per-kind only, per-channel, per-sender?
3. **Storage shape**: row per user × kind, sparse (absence means default), or row per user × kind materialized upfront for every known kind?
4. **Email rendering path**: synchronous joins in the mailer vs denormalize on the Notification row at fan-out time?

## Decision

### Default is opt-out (emails on until toggled off)

Matches the behavior of every product whose notifications shape we're imitating — Slack, GitHub, Linear, Vercel all default `@-mentions` to "email you." Users who want silence opt out; users who didn't pick up on the preference toggle still get the signal that someone wanted their attention.

Implemented as: the absence of a `NotificationPreference` row for `(user, kind)` means "email enabled." Rows only exist when a user has explicitly taken action — most commonly, opted out. Reset-to-default is a row delete.

### Preferences are per-kind (only)

No per-channel, per-sender, per-org toggles in this PR. ADR-0014 committed to "preferences land when a second kind makes them meaningful" and the second kind isn't here yet — but we need preferences before email ships, because shipping email-by-default without an off switch is the wrong direction. Per-kind is the minimum useful surface.

Per-channel is the natural next expansion when DMs land (you'll want different noise levels for a low-traffic announcements channel vs a high-traffic team channel). The `NotificationPreference` schema takes that into account by keeping `(user_id, kind)` as a unique pair rather than `(user_id, kind, channel_id)` — when per-channel arrives, the simplest shape is a new `NotificationChannelPreference` entity, leaving the kind-level toggle as a fallback.

### Sparse row storage

`NotificationPreference` holds at most one row per `(user_id, kind)`, and only exists when the user has explicitly set a value. Handlers fill in the default (email enabled) for kinds the user hasn't touched. This means:

- A fresh user has zero rows and gets emails.
- An opt-out is one row with `email_enabled = false`.
- An opt-back-in is either an update to that row or a delete. We implement it as an update (SetPreference upserts); deletions are not part of the public API.
- The mailer's poll predicate is `WHERE recipient has no matching preference row OR preference.email_enabled = true`.

### Synchronous joins in the mailer

When emailing, the mailer loads the `Message`, `Channel`, and sender `User` directly. Alternative was denormalizing those fields onto the `Notification` row at fan-out time; rejected because:

- Email volume is low (order of writes, not messages), so the extra queries per send are trivial.
- Denormalized values go stale when channels or users are renamed — a notification emailed weeks after a channel was renamed would still say the old name.
- `Notification` is supposed to be the minimum in-app inbox shape. Piling display data onto it couples the storage to a specific rendering surface.

### One config key — `app.base_url`

Generic application root URL. The mailer appends `/channels/<channel_id>#message-<message_id>` for deep-link-to-message. Future password-reset, digest, and notifications-for-other-kinds mailers will reuse the same root rather than each introducing a `<worker>.link_base_url` config.

## Alternatives considered

- **Opt-in (email off by default).** Rejected. The whole point of `@`-mentioning someone is to ask for their attention; defaulting to silence defeats the feature. Some regulated environments may need opt-in; that's a future per-deployment policy knob, not the default.

- **Row per (user, kind) materialized upfront.** Considered. Would remove the "is this default or explicit?" branch in the handler. Rejected because: (a) adding a new kind then requires a backfill migration for every existing user, (b) users who never touch preferences still incur a write, (c) the "no row = default" pattern is easy to document and explicit in the schema.

- **Denormalize message body + sender + channel onto Notification.** Considered (see above). Rejected on staleness + coupling grounds.

- **Email through the invitations.Mailer pattern verbatim.** Considered. Mailer shape is identical on the surface, but the preference-gated poll query is different enough that sharing a worker implementation between invites (which everyone gets, no opt-out) and notifications (opt-outable) would be more coupling than copying. Two small workers, one shared Sender — right granularity.

- **Fold email-on-mention into the existing `notifications.Consumer`.** Considered. Would save one goroutine. Rejected because the consumer's job is "materialize Notification rows from outbox events" and the mailer's job is "deliver unsent Notification rows to email"; combining them would mean emails fail when the consumer crashes mid-fan-out, and a transient email failure would risk partial fan-out. Separate workers, separate retry loops.

## Consequences

**Positive.**
- Notifications is now a complete feature: users see mentions in-app AND get emails unless they opt out. The in-app list carries `emailed_at` for display ("email sent 2 minutes ago").
- The email abstraction ([ADR-0013](./email-invitations-and-email-abstraction)) now has two real consumers. The pattern — `email.Sender` interface + log + smtp drivers + per-domain mailer worker — is the template for password reset, digest emails, and anything else that needs outbound mail.
- `app.base_url` is a small but load-bearing config key for every future user-facing email; adding it once here means no worker ever has to invent its own.
- Preferences UX is simple: one toggle per kind. Users aren't drowned in a settings page that mostly duplicates kind-level defaults.

**Negative.**
- Sparse rows mean the handler has to merge DB rows with the `knownKinds` list at read time. Adding a new kind requires two code changes: the enum on the ent schema + the `knownKinds` slice. Missing either silently breaks discoverability (user can't toggle, but will still get emails).
- Synchronous joins in the mailer add 3 queries per email send. Fine at today's volume; revisit if email-per-second becomes a bottleneck. The denormalization fallback is available.
- Opt-out default means a noisy sender can email a recipient who never opted in. For MVP acceptable — users can opt out in one call. Rate-limiting (per-recipient, per-time-window) is a future PR when abuse patterns surface.

## Out of scope

- **Per-channel preferences.** Lands with DMs / high-traffic channel scenarios. Schema is designed so the addition is a new entity, not a breaking change to this one.
- **Per-sender preferences** ("mute Alice's mentions"). Distinct from block/mute for messaging generally. Future PR.
- **Digest emails** ("here are your 12 unread mentions from today"). Different scheduling shape. Reuses `email.Sender` and `app.base_url`.
- **HTML email templates.** Plain text only, same as invites. Template engine lands with a broader email-templates PR.
- **Rate limiting** / anti-spam on outgoing notification emails. No limiter today; add when volume dictates.
- **Internationalization.** Emails are English-only; translatable templates when we pick up a second locale.
- **Bounces + suppression list.** Permanent bounces should stop retries; today we retry indefinitely. Lands with a broader email-reliability PR.
