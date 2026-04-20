---
title: "ADR 0005 — Markdown for message body"
sidebar_label: "0005 · Markdown body"
---

# ADR 0005 — Markdown for message body

**Status:** Accepted
**Date:** 2026-04-20

## Context

`MessageService.Send` carries a body — text the user typed into a channel. We had to decide what shape that field is on the wire and at rest:

1. A plain `string` the server treats as opaque, rendered by clients as Markdown.
2. A structured proto (`oneof` of plain / Markdown / HTML, or "blocks" like Slack's BlockKit).
3. A hybrid (Matrix-style) — canonical plaintext plus an optional pre-rendered HTML field.

The decision had to live with end-to-end encryption (the project's MLS roadmap), full-text search (OpenSearch in the Phase 3 backbone), and a deliberately small public API surface.

## Decision

The Message body is a **single `string` field, treated as Markdown by clients and as opaque text by the server**. The server enforces only two rules:

- non-empty
- ≤ 8 KiB (8192 bytes)

There is **no `body_format` enum** — the format is fixed in the proto field comment and stays a single source of truth. Structured concerns (mentions, attachments, threads, reactions) become *separate fields* on the Message in their own RPCs as they land; they are not encoded inside the body.

```proto
message Message {
  // Markdown text. Server treats as opaque; clients render. Max 8 KiB.
  // Format is intentionally not parameterised — there is no body_format
  // enum. If a future variant is needed it will land as a separate field.
  string body = 4;
  // ...
}
```

## Alternatives considered

- **Structured proto body (oneof / blocks).** Rejected. The server would have to understand the structure to do anything useful with messages, which makes the MLS end-to-end-encryption story much harder — under E2EE the server cannot read the body. Slack invented mrkdwn and blocks and is still paying the maintenance cost; Mattermost and Matrix went markdown-text and have not regretted it.

- **`body_format` enum (PLAIN / MARKDOWN / HTML).** Rejected as the "we'll figure it out later" pattern. It creates eternal handler complexity (every consumer branches on the enum) without enabling anything that a separate-field-when-we-need-it approach would not.

- **Hybrid (Matrix-style `body` + `formatted_body`).** Deferred, not rejected. If a future client ships a really good editor whose output is hard to reproduce by parsing the Markdown alone, we can add a server-side `body_html` field as an additive, optional optimization — without changing the canonical body or breaking existing clients.

## Consequences

**Positive.**
- E2EE-friendly. Making the server blind to the body in a future MLS phase requires no schema change.
- Any client (web, mobile, terminal bot, accessibility tools) needs only a Markdown renderer — no custom parser, no server-rendered HTML to trust.
- OpenSearch indexes Markdown well; optional syntax stripping at index time if needed.
- Mentions, threads, attachments, reactions become explicit fields/entities later — easier to evolve, easier to authorize, easier to audit. The body never becomes a sub-protocol.

**Negative.**
- Notification previews ("**Alice**: hello @bob") show raw Markdown unless the notification consumer renders it. Acceptable; can be addressed by the notifier when it lands.
- Servers cannot enforce mention semantics ("you @-mentioned someone, so they get notified") from the body alone. Resolved by making mentions a separate `repeated string mention_user_ids` field on Send, which the client populates and the server can validate.
- 8 KiB is a deliberate cap. Slack is 40 k chars, Discord is 2 k, Matrix is unbounded. We start conservative and revise upward only with a use case.

## Out of scope

- Editing and deleting messages (deferred from Phase 2b — adding `edited_at` is straightforward when the RPC lands).
- Server-side rendering to HTML / Open Graph previews (additive when needed).
- Markdown dialect specification (CommonMark vs GFM vs custom extensions). Practically, Markdown is what the chosen client renderer accepts; we will pin a dialect in a follow-up ADR if interop becomes a problem.
