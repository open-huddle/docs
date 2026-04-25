---
sidebar_position: 2
title: Local development
description: Bring up the Open Huddle stack on your laptop.
---

# Local development

These instructions reflect the **current pre-alpha state** of the project. They will expand as more services land.

## Prerequisites

- **Go** (matching the version in [`apps/api/go.mod`](https://github.com/open-huddle/huddle/blob/main/apps/api/go.mod))
- **Node.js** 20+ and **pnpm** 10+
- **Docker** with Compose
- **[Atlas](https://atlasgo.io/getting-started)** for applying database migrations
- **[buf](https://buf.build/product/cli)** for proto code generation, lint, and `buf curl`
- **make**

## Clone and bootstrap

```bash
git clone https://github.com/open-huddle/huddle.git
cd huddle
make install
```

`make install` runs `pnpm install` and `go work sync` so every workspace package resolves.

## Start local dependencies

```bash
make dev-up
```

This starts the supporting services via Docker Compose:

| Service | Port | Notes |
|---|---|---|
| **PostgreSQL** | 5432 | Hosts both the `huddle` (API) and `keycloak` databases. |
| **Valkey** | 6379 | In-memory cache and presence store (not yet wired into the API). |
| **Keycloak** | 8180 (HTTP), 9000 (management) | Identity provider; realm `huddle` is auto-imported on first boot. |
| **NATS** | 4222 (client), 8222 (monitoring) | JetStream-enabled event bus. Used today for realtime message fan-out; notification consumer lands later in Phase 3. |
| **OpenSearch** | 9200 (HTTP) | Full-text search backend. The API's `search.Indexer` writes message projections here and `SearchService.SearchMessages` reads them. Dev-mode runs single-node with the security plugin disabled (Helm re-enables it). |

Stop them with `make dev-down`. Add `-v` (`docker compose -f deploy/compose/docker-compose.yml down -v`) to wipe data — needed when you change the realm import or the Postgres init scripts, since both run only on first-volume boot.

### Optional: Debezium CDC bridge

Postgres in `dev-up` boots with `wal_level=logical` so the future Debezium-driven publisher (see [ADR-0018](/adr/debezium-cdc-foundations)) can attach a replication slot. The Debezium Server container itself is **profile-gated** — `make dev-up` does not start it. To run the full CDC stack:

```bash
make dev-up-debezium
```

This brings up the same five services plus a `debezium` container that tails `outbox_events` and publishes each new row to NATS, with the topic taken from the row's stored `subject` column.

By default the in-process `outbox.Publisher` is **also** running, so every row is published to NATS twice (once by each path). Subscribers dedupe on message UUID so the realtime UI is fine, but it's wasteful. To make Debezium the sole publisher, set the driver toggle when starting the API:

```bash
HUDDLE_OUTBOX_PUBLISHER_DRIVER=none make api-run
```

The API logs a `Warn` at startup confirming the in-process publisher is disabled and noting that an out-of-band CDC bridge MUST be running — if you forget to bring up the Debezium profile, realtime Subscribe will see no events. A typo in the driver value (`in-process` instead of `in_process`, for example) fails startup with an error naming the offending config key, so a misconfiguration cannot silently disable fan-out.

## Apply database migrations

```bash
make migrate-apply
```

The API uses [Ent](https://entgo.io) for the schema and [Atlas](https://atlasgo.io) for versioned, auditable migrations — see [ADR-0004](/adr/versioned-migrations-ent-atlas) for the rationale. Migration files live under [`apps/api/migrations/`](https://github.com/open-huddle/huddle/tree/main/apps/api/migrations).

To generate a new migration after editing an Ent schema:

```bash
make migrate-diff NAME=add_threads    # writes apps/api/migrations/<ts>_add_threads.sql
```

`make migrate-status` shows what is and isn't applied against the local database.

## Run the API

```bash
make api-run
```

The API listens on `:8080` by default and exposes:

| Path | Auth | Description |
|---|---|---|
| `GET /livez` | none | Process liveness (Kubernetes probe). |
| `GET /readyz` | none | Pings PostgreSQL; 503 if the DB is unreachable. |
| `POST /huddle.v1.HealthService/Check` | none | Connect health RPC. |
| `POST /huddle.v1.IdentityService/WhoAmI` | bearer | Returns the calling user; upserts the row on first call. |
| `POST /huddle.v1.OrganizationService/{Create, List, AddMember}` | bearer | Tenant + membership management. |
| `POST /huddle.v1.OrganizationService/{InviteMember, AcceptInvitation}` | bearer | Email-invite flow. See [ADR-0013](/adr/email-invitations-and-email-abstraction). |
| `POST /huddle.v1.ChannelService/{Create, List, Get}` | bearer | Channels (per-org slug-unique). |
| `POST /huddle.v1.MessageService/{Send, List, Edit, Delete}` | bearer | Send, list, edit, and soft-delete messages. Edit is author-only; Delete is author or admin/owner. See [ADR-0016](/adr/message-edit-delete). |
| `POST /huddle.v1.MessageService/Subscribe` | bearer | **Server-streaming** — pushes creates, edits, and deletes. Responses carry a `oneof event { created, edited, deleted }`; clients switch on variant. See [ADR-0006](/adr/connect-streaming-for-realtime) for the streaming choice and [ADR-0017](/adr/realtime-v2) for the envelope. |
| `POST /huddle.v1.SearchService/SearchMessages` | bearer | Full-text search over indexed messages. See [ADR-0010](/adr/search-service-and-indexer). |
| `POST /huddle.v1.NotificationService/{List, MarkRead, GetPreferences, SetPreference}` | bearer | In-app notifications inbox (@-mentions today) + per-kind email preferences (default opt-out; see [ADR-0015](/adr/notification-email-delivery)). |

Verify the public surface:

```bash
curl -X POST http://localhost:8080/huddle.v1.HealthService/Check \
  -H "Content-Type: application/json" -d '{}'
# {"status":"STATUS_SERVING","version":"dev"}

curl -i http://localhost:8080/readyz   # 200 if PostgreSQL is reachable, 503 otherwise
```

## Background workers

`apps/api` runs seven in-process goroutines alongside the HTTP server. They start with the process and exit on shutdown; there is nothing extra to launch.

| Worker | What it does | Default cadence |
|---|---|---|
| `outbox.Publisher` | Drains `outbox_events` rows to NATS on the subject stored per row. Poll query uses `FOR UPDATE SKIP LOCKED` on Postgres so multiple API replicas drain disjoint rows (see [ADR-0012](/adr/skip-locked-outbox-claim)). | 1s poll, 100-row batch |
| `audit.Consumer` | Mirrors un-audited `outbox_events` rows into `audit_events` (the compliance projection). Reads the table directly, not NATS, so broker outages cannot lose audit rows. | 2s poll, 200-row batch |
| `search.Indexer` | Projects `message.created` outbox rows into OpenSearch at the `huddle-messages` alias. Stamps `indexed_at` on the outbox row so retries upsert cleanly. Same `FOR UPDATE SKIP LOCKED` claim as the publisher. | 2s poll, 200-row batch |
| `outbox.GC` | Deletes outbox rows that are fully published, fully audited, fully indexed, AND older than `outbox.retention` (default 24h). The FK on `audit_events.outbox_event_id` is `ON DELETE SET NULL` — audit rows survive the delete with their denormalized fields intact. | 5m poll, 500-row batch |
| `invitations.Mailer` | Sends pending invitation emails. Polls `invitations` where `email_sent_at IS NULL AND expires_at > now() AND accepted_at IS NULL`, calls `email.Sender`, records an `EmailDelivery` row, stamps `email_sent_at` and clears the plaintext token. See [ADR-0013](/adr/email-invitations-and-email-abstraction). | 5s poll, 50-row batch |
| `notifications.Consumer` | Fans out `Notification` rows from `message.created` outbox events — one per `mention_user_id`. Stamps `notified_at` on every row it evaluates so `outbox.GC` can proceed. See [ADR-0014](/adr/notifications-consumer-and-mentions). | 2s poll, 200-row batch |
| `notifications.Mailer` | Sends notification emails for `Notification` rows where `emailed_at IS NULL` and the recipient hasn't opted out (default is opt-out / industry norm). Joins `Channel` + `User` + `Message` for the body; calls `email.Sender`; stamps `emailed_at`. See [ADR-0015](/adr/notification-email-delivery). | 5s poll, 50-row batch |

The first three workers read the same `outbox_events` table and stamp independent markers (`published_at`, the `audit_events` sibling row, `indexed_at`); the GC worker deletes rows where all three markers are set. Migrations that shape this: `20260421220110_add_outbox_and_audit.sql`, `20260422131158_add_outbox_indexed_at.sql`, and `20260422192521_decouple_audit_outbox_fk.sql`, all picked up by `make migrate-apply`. See [ADR-0009](/adr/transactional-outbox-and-audit-consumer) for the outbox pattern, [ADR-0010](/adr/search-service-and-indexer) for the search indexer, [ADR-0011](/adr/outbox-gc-and-audit-decoupling) for the GC + FK decoupling, and [Audit logging](/compliance/audit-logging) for what ends up in `audit_events`.

## Get a token from Keycloak

The dev realm seeds two users — **`alice` / `alice`** and **`bob` / `bob`** (both `…@example.com`) — and one client (`huddle-web`) with the password grant enabled for testing. Production deployments will not enable the password grant.

```bash
TOKEN=$(curl -sS -X POST \
  http://localhost:8180/realms/huddle/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=huddle-web&username=alice&password=alice&scope=openid email profile" \
  | jq -r .access_token)
```

The token's `aud` claim contains `huddle-api` thanks to the audience mapper in the realm import.

## Walk through the API

```bash
# Bootstrap the calling user row + see your identity
curl -sS -X POST http://localhost:8080/huddle.v1.IdentityService/WhoAmI \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
# {"userId":"<uuid>","subject":"<sub>","email":"alice@example.com","displayName":"Alice Anderson"}

# Found an organization (caller becomes owner)
ORG=$(curl -sS -X POST http://localhost:8080/huddle.v1.OrganizationService/Create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Acme","slug":"acme"}' | jq -r .organization.id)

# Create a channel inside it
CH=$(curl -sS -X POST http://localhost:8080/huddle.v1.ChannelService/Create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"organization_id\":\"$ORG\",\"name\":\"General\",\"slug\":\"general\"}" \
  | jq -r .channel.id)

# Send a Markdown message (optionally @-mentioning org members via
# mention_user_ids; ids must belong to the channel's organization).
curl -sS -X POST http://localhost:8080/huddle.v1.MessageService/Send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"channel_id\":\"$CH\",\"body\":\"hello with **markdown**\"}"

# List recent messages (newest first, cursor-paginated; mention_user_ids
# is hydrated from the message_mentions join table).
curl -sS -X POST http://localhost:8080/huddle.v1.MessageService/List \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"channel_id\":\"$CH\",\"limit\":50}"

# Edit the message (author-only) — note the id comes back as message.id
# from the Send response. edited_at stamps each successful call.
curl -sS -X POST http://localhost:8080/huddle.v1.MessageService/Edit \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\":\"<message-id>\",\"body\":\"edited *markdown*\"}"

# Soft-delete (author OR admin/owner). Subsequent List calls won't show
# the row; the row stays in Postgres for audit.
curl -sS -X POST http://localhost:8080/huddle.v1.MessageService/Delete \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\":\"<message-id>\"}"
```

## Check your notifications

Whenever a message lands with `mention_user_ids` including your user id, `notifications.Consumer` materializes a `Notification` row for you within ~2 seconds. The inbox is served by `NotificationService.List` (unread-only by default):

```bash
# Bob's side: list @-mentions he hasn't read yet.
curl -sS -X POST http://localhost:8080/huddle.v1.NotificationService/List \
  -H "Authorization: Bearer $BOB_TOKEN" -H "Content-Type: application/json" -d '{}'

# Mark one read by id — idempotent.
curl -sS -X POST http://localhost:8080/huddle.v1.NotificationService/MarkRead \
  -H "Authorization: Bearer $BOB_TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\":\"<notification-uuid>\"}"
```

Within ~5s of the Notification landing, `notifications.Mailer` emails Bob (log-driver in dev — the full email lands in the API log). Bob can opt out per-kind:

```bash
# Get current preferences — defaults to email_enabled=true for every known kind.
curl -sS -X POST http://localhost:8080/huddle.v1.NotificationService/GetPreferences \
  -H "Authorization: Bearer $BOB_TOKEN" -H "Content-Type: application/json" -d '{}'

# Opt out of mention emails (he'll still see them in the in-app inbox).
curl -sS -X POST http://localhost:8080/huddle.v1.NotificationService/SetPreference \
  -H "Authorization: Bearer $BOB_TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"mention","email_enabled":false}'
```

See [ADR-0014](/adr/notifications-consumer-and-mentions) for the mention-model rationale and [ADR-0015](/adr/notification-email-delivery) for the email-delivery + preferences shape.

## Subscribe to live messages

`MessageService.Subscribe` is a server-streaming RPC. The simplest way to drive it locally is `buf curl`:

```bash
buf curl --schema proto --protocol connect --http2-prior-knowledge \
  --header "Authorization: Bearer $TOKEN" \
  --data "{\"channel_id\":\"$CH\"}" \
  http://localhost:8080/huddle.v1.MessageService/Subscribe
```

Open this in one terminal, then run the `Send`, `Edit`, or `Delete` curls in another — each one prints a response with a different `event` variant populated:

```json
// A Send — the "created" variant:
{"created":{"message":{"id":"...", "body":"hello", ...}}}
// An Edit on that same message — the "edited" variant (same Message shape, with edited_at set):
{"edited":{"message":{"id":"...", "body":"edited", "edited_at": "..."}}}
// A Delete — the "deleted" variant (ids only; body was soft-deleted):
{"deleted":{"message_id":"...", "channel_id":"..."}}
```

The stream starts at "now" (no replay); use `List` to backfill history on connect or reconnect.

Realtime delivery is fan-out: every connected subscriber for a channel receives every mutation. Underneath, publishes go to NATS JetStream on `huddle.messages.{created,edited,deleted}.<channel_id>`; a single ephemeral consumer per stream filters on `huddle.messages.*.<channel_id>` and dispatches to the right oneof variant. See [ADR-0007](/adr/event-broker-from-day-one) for the broker choice and [ADR-0017](/adr/realtime-v2) for the envelope redesign.

## Invite a member by email

`InviteMember` mints a single-use token, persists its HMAC, and enqueues the email. The `invitations.Mailer` goroutine picks it up within ~5 seconds; in dev (`email.driver: log`, the default) the rendered body lands in the API log rather than reaching an SMTP relay.

```bash
# Alice invites bob@example.test as a member of her org.
curl -sS -X POST http://localhost:8080/huddle.v1.OrganizationService/InviteMember \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"organization_id\":\"$ORG\",\"email\":\"bob@example.test\",\"role\":\"member\"}"
```

Within a few seconds, grep the API log for the rendered email and pull the token out of the accept URL:

```bash
# The LogSender prints a structured record at key `email.body` containing the URL.
# Run `make api-run` in one terminal; the InviteMember call emits an `email.send`
# line with the body embedded. Copy the token off `?token=<…>`.
```

```bash
# Bob signs in via Keycloak, then accepts with the copied token.
# His bearer token comes from a new `grant_type=password&username=bob&password=bob`
# request against the same Keycloak realm; the seeded dev realm has Bob.
BOB_TOKEN=...  # from Keycloak, matching bob@example.test

curl -sS -X POST http://localhost:8080/huddle.v1.OrganizationService/AcceptInvitation \
  -H "Authorization: Bearer $BOB_TOKEN" -H "Content-Type: application/json" \
  -d "{\"token\":\"<token-from-email>\"}"
```

Accept creates the Membership row and stamps the invitation terminal. The `Invitation.token_plaintext` column is cleared post-send (and again on accept as belt-and-braces); the hash lives on for as long as the invitation row does.

To wire real SMTP (Mailpit, Mailhog, a production relay), set `email.driver: smtp` and fill in `email.smtp.host/port/username/password/start_tls`. See [ADR-0013](/adr/email-invitations-and-email-abstraction) for the rationale on HMAC, plaintext at rest, and why the mailer reads the Invitation table rather than the outbox payload.

## Search messages

Once you've sent a few messages, `SearchService.SearchMessages` can find them by content. Indexing is asynchronous — a just-sent message is typically findable 2–3 seconds later (the indexer's default poll cadence).

```bash
curl -sS -X POST http://localhost:8080/huddle.v1.SearchService/SearchMessages \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"organization_id\":\"$ORG\",\"query\":\"markdown\"}"
```

Hits come back with a `snippet` field that wraps matched tokens in `**bold**` — Markdown-friendly, so clients render hits with the same pipeline they render message bodies with. The response also carries a `next_cursor`; pass it back on the next call to page through results. The caller must be a member of `organization_id`; every query is filtered to that tenant server-side before it touches OpenSearch. See [ADR-0010](/adr/search-service-and-indexer) for the full design.

Peek at the index directly if you want to confirm a message has landed:

```bash
curl -sS 'http://localhost:9200/huddle-messages/_search?pretty' \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match_all":{}},"_source":["id","body","created_at"]}'
```

## Without a token

Authenticated RPCs return Connect's `unauthenticated` (HTTP 401):

```bash
curl -i -X POST http://localhost:8080/huddle.v1.IdentityService/WhoAmI \
  -H "Content-Type: application/json" -d '{}'
# HTTP/1.1 401 Unauthorized
```

Authorization failures (e.g. listing channels in an organization you are not a member of) return `permission_denied` (HTTP 403). See [ADR-0008](/adr/handler-level-authorization) for where the checks live.

## Keycloak admin console

The admin console is at [http://localhost:8180](http://localhost:8180) — credentials **`admin` / `admin`** (dev only). The `huddle` realm is pre-imported with the `huddle-web` client and the seeded users. Edits made in the console persist in the `keycloak` database; they are **not** written back to `deploy/compose/keycloak/huddle-realm.json`. To make a change permanent for other contributors, edit the JSON and re-seed via `make dev-down -v && make dev-up`.

## Run the web app

In a separate terminal:

```bash
make web-run
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/huddle.v1/*` to the API on `:8080`, so the health card should render "serving". A real channels-and-messages UI ships in a later phase.

## Regenerating protos

After editing anything under `proto/`:

```bash
make proto
```

Generated code under `gen/` is committed. Re-run tests and lints after regenerating.

## Useful targets

| Target | What it does |
|---|---|
| `make lint` | Runs golangci-lint, ESLint, and `buf lint`. |
| `make test` | Runs Go unit tests (SQLite-backed, no Docker needed). |
| `make test-integration` | Runs Postgres-backed integration tests behind `//go:build integration`. Requires Docker — spins up Postgres via testcontainers. |
| `make fmt` | Formats Go and TypeScript sources. |
| `make api-build` | Builds the Go API binary into `apps/api/bin/api`. |
| `make web-build` | Production-builds the web app into `apps/web/dist`. |
| `make ent-generate` | Regenerates Ent code from `apps/api/ent/schema/`. |
| `make migrate-diff NAME=<desc>` | Generates a new Atlas migration from Ent schema changes. |
| `make migrate-apply` | Applies pending Atlas migrations to the local database. |
| `make migrate-status` | Shows Atlas migration status against the local database. |
