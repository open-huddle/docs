---
sidebar_position: 3
title: Backups and disaster recovery
description: How Open Huddle is backed up and restored.
---

# Backups and disaster recovery

:::warning Pre-alpha
These flows are documented for the target state. The tooling is in place; the runbooks are not.
:::

Open Huddle ships two complementary backup paths:

## Postgres — pgBackRest

**pgBackRest** handles point-in-time-recovery backups of the authoritative database. It supports:

- Full, differential, and incremental backups on a configurable schedule
- Encrypted backup repositories (S3, GCS, Azure Blob, filesystem)
- Parallel compression and restore

Restore from a full backup for a dev or staging environment with a documented runbook step.

## Cluster — Velero

**Velero** handles Kubernetes-level DR:

- Namespace backups (including PVC contents)
- Scheduled snapshots
- Cross-cluster restore

Velero is your escape hatch when the cluster — not the database — is what's lost.

## Retention

Retention is operator-owned. The Helm chart exposes schedule and retention values but intentionally does not pick a default that might violate your compliance regime.

Rule of thumb for a HIPAA deployment:

- Database backups: at least 6 years of daily + monthly archives (encrypted)
- Audit log: matching the database retention window
- Velero snapshots: 30–90 days for rollback, separate from compliance backups
