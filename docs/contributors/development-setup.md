---
sidebar_position: 1
title: Development setup
description: Get a contributor environment running on your machine.
---

# Development setup

Open Huddle is an open-source project that depends on contributions from the community. This page tells you how to get a contributor environment going; [Coding standards](./coding-standards) covers what we expect from the code you send back.

## Get the code

```bash
git clone https://github.com/open-huddle/huddle.git
cd huddle
```

Follow the [Local development](../getting-started/local-development) guide to bring up the stack.

## Sign off your commits (DCO)

Open Huddle uses the [Developer Certificate of Origin](https://developercertificate.org/), not a CLA. Sign off every commit:

```bash
git commit -s -m "feat(messaging): add reactions"
```

The trailer looks like:

```text
Signed-off-by: Your Name <your.email@example.com>
```

Unsigned commits will be rejected by automation.

## Branch and PR flow

1. Fork the repo and create a topic branch from `main`.
2. Keep changes focused — one logical change per PR.
3. Run `make lint`, `make test`, and `make proto-breaking` before pushing.
4. Fill in every section of the PR template, including the compliance checklist where applicable.
5. A maintainer reviews and either merges, requests changes, or escalates via the RFC process.

See [RFC process](./rfc-process) for changes that need a formal proposal first.

## Getting help

- **Usage questions:** [GitHub Discussions](https://github.com/open-huddle/huddle/discussions)
- **Security:** see [SECURITY.md](https://github.com/open-huddle/huddle/blob/main/SECURITY.md) — do not open public issues
- **Conduct:** [conduct@open-huddle.org](mailto:conduct@open-huddle.org)
