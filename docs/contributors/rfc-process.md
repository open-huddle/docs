---
sidebar_position: 3
title: RFC process
description: When and how to write a Request For Comments before shipping code.
---

# RFC process

Small, well-scoped changes land via the normal PR flow. Some changes are too consequential to discuss only inside a PR — they need a written proposal first.

## When to write an RFC

An RFC is required for any of the following:

- New subsystems or services
- Changes to the **public API** or on-disk / on-wire formats
- Changes to the **core stack** (Go, React, Postgres, LiveKit, etc.)
- Changes to the [Governance document](https://github.com/open-huddle/huddle/blob/main/GOVERNANCE.md) or [Code of Conduct](https://github.com/open-huddle/huddle/blob/main/CODE_OF_CONDUCT.md)
- Changes to **licensing**, **compliance posture**, or **security model**

If in doubt: open a GitHub Discussion first and ask.

## Writing the RFC

Open an issue titled `RFC: <short summary>`. It must contain:

1. **Problem.** What's broken, missing, or too costly today.
2. **Proposal.** The specific solution, precise enough to implement.
3. **Alternatives considered.** At least two. "Do nothing" counts.
4. **Compliance, security, and operational implications.** Explicit section — reviewers will ask.
5. **Migration plan.** If existing installs are affected, how they move.

## Comment window

RFCs stay open for **at least 7 days**. Longer if contentious.

## Approval

- Simple majority of the TSC, or of maintainers if the TSC doesn't exist yet.
- A `-1` from any TSC member blocks; disagreements are resolved by discussion or by TSC vote.

Once approved, the RFC is linked from the PR(s) that implement it. An ADR captures the final decision — see the [ADR directory](../adr).
