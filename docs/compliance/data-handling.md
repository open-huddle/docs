---
sidebar_position: 3
title: Data handling
description: How Open Huddle classifies, stores, and protects data.
---

# Data handling

## Data classes

| Class | Examples | Where it may appear |
|---|---|---|
| **Public** | Feature documentation, system announcements | Documentation, blog |
| **Internal** | Audit metadata, request IDs, structural data | Audit log, observability stack |
| **Confidential** | Message bodies, attachment contents, call recordings | Postgres (encrypted), object store (encrypted), never logs |
| **Restricted (PHI)** | Any of the above under a HIPAA deployment | Same as Confidential; additional retention and BAA requirements |

## Storage boundaries

- **Postgres** holds structured data — users, channels, messages, memberships, audit metadata.
- **SeaweedFS** holds unstructured data — attachments, call recordings, avatars.
- **Valkey** holds ephemeral state — presence, rate-limit counters, session scratch space. Never PHI.
- **OpenSearch** holds search-indexable projections. Sensitive fields are tokenized before indexing.

## What is never written anywhere

- Plaintext passwords. Keycloak owns credentials; the API never handles them.
- API tokens, OIDC refresh tokens, or any bearer material — even in debug logs.
- Full message bodies in application logs — even at trace level.

## Encryption

- **In transit:** TLS between the client and the gateway; mTLS between services (Linkerd).
- **At rest:** operator-configured. The Helm chart defaults to requiring encrypted Postgres volumes and encrypted object-store buckets.
- **End-to-end:** planned via MLS; not available yet. An ADR will be filed before implementation.

## Deletion

Deletion is a first-class operation, not a best-effort. When a user is purged:

1. Their account is deactivated at Keycloak.
2. Their messages are tombstoned in Postgres (retained per audit policy but no longer readable via the API).
3. Their attachments are removed from SeaweedFS.
4. OpenSearch projections are rebuilt to omit the content.
5. A tombstone event is emitted to the audit log.

Operators configure whether tombstones survive backups or are purged on restore.
