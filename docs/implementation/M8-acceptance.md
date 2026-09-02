# M8 Auth + Privacy + Continuity — Acceptance Record

Status: **M8-G acceptance closure candidate**

This document is a bounded implementation/acceptance record. Product authority remains with the Owner-approved M8 sources, especially `docs/design/Lattice-Owner-Decision-OD-007-M8-Continuity.md`, `docs/design/M8-Auth-Privacy-Continuity-Architecture.md`, and `docs/design/Lattice-Architecture-Integrity.md`.

## Scope

M8 establishes authenticated subject ownership, Conversation-derived object isolation, subject-scoped idempotency, explicit USER-controlled preference continuity, deletion-state enforcement, and continuity boundaries that preserve existing Intent Authority, V36 Truth Core, Decision Engine, Execution Runtime, and Solandra semantic ownership.

M8 does **not** establish generalized memory, provider selection, live-provider promotion, retention duration, production deployment, or production readiness.

## Acceptance matrix

| OD-007 acceptance requirement | Product-observable evidence surface |
|---|---|
| Independently authenticated subject boundary | `test/authenticated-subject.test.ts`, `test/m8-conversation-ownership.test.ts` |
| Cross-user Conversation access fails closed and non-disclosing | `test/m8-conversation-ownership.test.ts` |
| Cross-user message, intent, DecisionPlan, Run, result, cancellation, progress/SSE, and continuity fail closed | `test/m8-durable-graph-isolation.test.ts` |
| Subject-scoped idempotency does not collide | `test/m8-subject-idempotency.test.ts` |
| Same-user durable ownership/state survives PostgreSQL reconnect | `test/m8-conversation-ownership.test.ts`, `test/m8-subject-idempotency.test.ts` |
| Explicit saved preferences remain subject-owned, USER-provenance-bound, durable, and applicable only through explicit reuse | `test/m8-explicit-preference-continuity.test.ts`, `test/m8-preference-intent-reuse.test.ts`, `test/m8-preference-controls-api.test.ts` |
| Preference changes do not rewrite historical IntentVersions or Runs | `test/m8-preference-intent-reuse.test.ts` plus existing exact IntentVersion/Run binding tests |
| Transcript/model/Solandra inference does not silently become persistent preference | `test/m8-explicit-preference-continuity.test.ts`, `test/m8-preference-controls-api.test.ts` |
| Historical external facts do not silently become reusable V36 truth | `test/v36-durable-result-admission.test.ts` — `M8 continuity does not silently reuse historical external facts as V36 truth` |
| Deletion immediately removes normal Conversation-derived access while retaining a separate tombstone/purge-policy distinction | `test/m8-deletion-lifecycle.test.ts` |
| Architecture Integrity remains intact | existing Intent Authority, V36, Decision Engine, Execution Runtime, Solandra boundary regressions plus the bounded M8 tests above; no M8 acceptance change transfers their semantic authority |

## Exact-candidate validation contract

M8-G requires one frozen candidate to pass:

1. the repository check gate, including all M8 memory/application regressions and the explicit historical-V36-nonreuse regression;
2. native PostgreSQL 18 durability including M8 Conversation ownership, subject idempotency, explicit preference state/reuse/controls, and deletion lifecycle;
3. the existing durable browser lifecycle regression to prove M8 changes do not regress authoritative Conversation/reconnect/presentation composition;
4. Architecture Integrity review of the final diff and canonical merge transition.

The PostgreSQL workflow is intentionally part of this closure: its M8 coverage includes the existing ownership and deletion PostgreSQL tests so those acceptance criteria are not inferred from unrelated durable probes.

## Boundaries preserved

- Retention duration remains unqualified and is not invented here.
- Purge execution remains outside the M8-F2 foundation unless separately qualified.
- Persisted preference is explicit USER-controlled structured state, not inferred generalized memory.
- Historical external facts remain subject to the current Run's V36 admission path.
- Intent Authority remains the authority for USER meaning and preference application.
- V36 remains the sole epistemic authority for truth admission.
- Decision Engine remains the authority for StructuredDecision semantics.
- Solandra remains presentation/advocacy, not truth, intent, or decision authority.
- M9 live-provider promotion is not begun or authorized by M8 acceptance.

## Completion rule

M8 may be marked complete only after the final M8-G candidate satisfies the exact-candidate validation contract above, is merged to canonical `main`, and the resulting canonical revision is validated or otherwise meets the governing exact/cross-revision validation requirements. A successful merge by itself is not Product acceptance.