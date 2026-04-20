---
sidebar_position: 2
title: Audit logging
description: What Open Huddle records, how it is stored, and how to feed it to a SIEM.
---

# Audit logging

Open Huddle's audit log is **not** application logs. It is an append-only record of state-changing events, designed to satisfy SOC 2 and HIPAA access-and-change-tracking requirements.

:::info
The audit-log service lands in a later phase. This page documents the design contract so downstream consumers can be built against it.
:::

## What is recorded

Every state-changing RPC produces one audit event containing:

| Field | Source |
|---|---|
| `event_id` | Monotonically-assigned ID |
| `event_time` | Server-authoritative timestamp |
| `actor` | Keycloak subject (`sub`) and display name |
| `actor_ip` | Client source IP (post-proxy) |
| `request_id` | Propagated through the request |
| `action` | The RPC method name (e.g. `huddle.v1.MessageService/Send`) |
| `resource` | Stable ID of the affected entity |
| `before` / `after` | Redacted diff — never contains message bodies or PHI |
| `outcome` | `SUCCESS` or an error code |

## Storage

Events are projected from the NATS JetStream event bus into a dedicated audit-log store. The store is append-only; updates and deletions are not a supported operation.

## Export

The audit log exports via:

- **Structured JSON** over HTTPS to a collector of your choice
- **OTLP** logs signal, for OTel-based pipelines

The default Helm chart assumes you'll route the stream to your SIEM (Splunk, Elastic, Chronicle, etc.). The project does not ship a SIEM.

## What is not in the audit log

- Message contents
- Attachment contents or metadata beyond size and MIME type
- Anything containing PHI / PII

If you need content for eDiscovery, that's a separate legal process against the authoritative database, not the audit log.
