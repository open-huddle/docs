---
title: "ADR 0008 — Handler-level authorization"
sidebar_label: "0008 · Handler-level authorization"
---

# ADR 0008 — Handler-level authorization

**Status:** Accepted
**Date:** 2026-04-20

## Context

Open Huddle authenticates at the edge: a Connect interceptor verifies the OIDC bearer token (Phase 1b) and stashes the claims on the request context. That answers "who is calling." It does not answer "may they perform *this* action on *that* resource."

Phase 1c needed to make that second decision. We had to choose where authorization checks live. The candidates were:

1. **In a Connect interceptor**, before the handler runs.
2. **At the database**, via Postgres Row-Level Security (RLS).
3. **In the handler itself**, between argument parsing and the side effect.

The decision shapes how every future RPC is written.

## Decision

Authorization checks live **at the handler level**. Each handler:

1. Parses the request and resolves the calling principal (the authenticated user row, via `internal/principal.Resolver`).
2. Calls `policy.Engine.Authorize(ctx, principalID, action, resource)` with the action it is about to perform and the concrete resource it is about to touch.
3. Performs the side effect only on a `nil` return; maps `policy.ErrDenied` to `connect.CodePermissionDenied` and any other error to `CodeInternal`.

The policy engine is a small abstraction (`internal/policy.Engine`) with one method. The current implementation, `policy.RBAC`, reads `Membership.role` and matches against a static `map[Action]map[Role]bool` permission table. Adding a new action means listing the lowest role that can perform it; no handler changes.

The Connect interceptor stays concerned with **authentication only**. It never makes authorization decisions.

## Alternatives considered

- **Authorization in a Connect interceptor.** Rejected. Interceptors see the RPC name and the request payload but not the *semantic* resource being acted on. For `OrganizationService.Create` it is an org-level "you may create" rule (no resource lookup needed), but for `MessageService.Send` the interceptor would have to look up the channel, find its organization, and check membership — duplicating work the handler is going to do anyway, or pushing all that lookup logic into a giant interceptor switch keyed on RPC name. Either way the handler can no longer trust that authorization has happened correctly without re-reading the interceptor.

- **Postgres Row-Level Security (RLS) only.** Rejected as the *only* mechanism. RLS is excellent at enforcing "you can only see rows that belong to your tenant" (we will likely add it as a defense-in-depth layer). It is not good at expressing "owner can mint a new owner; admin cannot" because that depends on the *caller's role* on the *parent organization*, not on which row is being touched. RLS also gives the wrong error shape — denied queries return empty result sets, not 403s — which is misleading to clients trying to distinguish "no data" from "no access." We may layer RLS later as a belt-and-braces guard; we will not depend on it as the only check.

- **Mixed (interceptor for cross-cutting + handler for resource-specific).** Rejected as a false economy. Splitting checks across two layers means readers have to look in two places to understand what an RPC enforces, and a missed handler-level check next to a permissive interceptor is silently broken. One place, one pattern.

## Consequences

**Positive.**
- Every authorization decision is visible at the call site. A reader of `internal/services/organization/organization.go` sees `s.authz.Authorize(...)` next to the action it gates; nothing happens elsewhere.
- The policy engine is one method. Swapping the in-process RBAC for OPA, Cedar, or any external policy decision point keeps the Engine contract identical — handlers do not change.
- Audit logging and tracing wrap the same `Authorize` call once and capture every authz decision uniformly.
- The error mapping is unambiguous: `ErrDenied` → 403, anything else → 500. Handlers do not have to know how the engine reached its decision.

**Negative.**
- Every handler that touches a resource must remember to call `Authorize` before the side effect. Mitigation: (a) the public RPC surface is small and reviewable, (b) the policy engine takes a `Resource` argument that makes "I forgot to check" obvious in code review, (c) integration tests will assert denials.
- Adding a defense-in-depth RLS layer later is additional work, not free. Acceptable; we have explicit handler checks today.
- An RPC that is authorization-less (e.g. health) must be mounted *without* the auth interceptor too — see `server.New` for the per-service mount pattern.

## Out of scope

- Postgres RLS as a defense-in-depth layer (a future ADR if we adopt it).
- Externalising the policy engine (OPA / Cedar). The Engine interface is shaped to allow the swap without ADR review when the time comes.
- Tenant-scoped query helpers that enforce the "only return rows in orgs you can see" pattern at the query layer. Today every handler scopes its own queries; a generic helper is on the consolidation list.
