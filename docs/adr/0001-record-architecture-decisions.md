---
title: "ADR 0001 — Record architecture decisions"
sidebar_label: "0001 · Record ADRs"
---

# ADR 0001 — Record architecture decisions

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Project maintainers

## Context

Open Huddle is a compliance-focused project with a target audience that will audit our decisions. We need a lightweight, durable record of significant architectural decisions — what we chose, what we considered, and why.

## Decision

We will record every significant architectural decision as an **Architecture Decision Record (ADR)**, stored in this documentation site under `docs/adr/`.

An ADR is:

- A short markdown file.
- Numbered sequentially (`0001`, `0002`, …).
- Never edited after it reaches **Accepted** — changes in direction are made by writing a new ADR that *supersedes* the old one.
- Linked from the [ADR index](/adr).

## Scope

ADRs are required for decisions that meet any of the thresholds in the [RFC process](../contributors/rfc-process): new subsystems, public API changes, core-stack changes, licensing and compliance changes, governance changes.

Small, local decisions (field names, function signatures) don't need an ADR.

## Consequences

**Positive.** Contributors joining later can reconstruct why. Auditors see a contemporaneous record. Disagreements surface as ADRs and not as shouting matches.

**Negative.** Writing ADRs takes time. Some decisions won't be as clean after the fact as they look in the ADR — that's fine, ADRs record direction, not internal debate.
