# WI-1 — Solandra Semantic Presentation Boundary

Status: implementation candidate on `wi1-solandra-semantic-presentation`.

## Bound product direction

The Owner-locked Solandra baseline replaces the planetary/orbital/Knowledge Orbit presentation. Presentation is derived from authoritative Product state through an application-owned semantic snapshot; the client renders that accepted snapshot and owns only temporary interaction state.

Authority remains with existing Product systems: Intent Authority for accepted intent, DecisionPlan for exact planning projection, V36 for factual/evidence authority, StructuredDecision/Decision Engine for eligibility/ranking/winner, and Execution Runtime for Run lifecycle.

## Implemented seams

- `GET /api/v1/conversations/:conversationId/presentation` returns the current accepted semantic presentation snapshot.
- `GET /api/v1/conversations/:conversationId/presentation/resources/:resourceId?presentationRevision=...` hydrates an application-issued resource only when the expected presentation revision is current.
- Both routes establish `AuthenticatedSubject -> owned Conversation -> conversation-derived Product state` before reading child state.
- Conversation continuity is also owner-scoped so the canonical UI does not depend on an unrestricted parent lookup.
- Presentation state is reconstructed from durable Product state; no independently mutable presentation-truth table is introduced.
- StructuredDecision remains the only source of an actionable winner.
- The canonical Solandra root and prototype entrypoints render the Owner-locked baseline rather than the former Sun/Planet/Moon/Knowledge Orbit renderer.
- Resource-open remains client view state, with full lower-field takeover and stale-revision protection.

## Validation boundary

Repository tests cover semantic composition, subject isolation, stale-resource rejection, the canonical baseline entrypoint, resource takeover behavior encoded in the baseline runtime, IME/Shift+Enter handling, reduced-motion/overflow constraints, and the authoritative lifecycle-to-presentation seam.

Exact browser/mobile/PostgreSQL restart acceptance remains a separate executed-evidence requirement. Passing repository tests alone must not be interpreted as full WI-1 Product acceptance or production readiness.
