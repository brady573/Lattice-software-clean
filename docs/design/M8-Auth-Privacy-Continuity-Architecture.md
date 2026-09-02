# M8 — Auth + Privacy + Continuity Architecture

Status: **OWNER-APPROVED M8 MILESTONE ARCHITECTURE — IMPLEMENTED BASELINE**

Approved direction: **explicit preference continuity; no generalized conversational memory for Lattice 1.0**.

Design baseline: `main @ 7e4932f443c5f19286c6e50f3bf702f1f356739b`.

Controlling OD-007 decision: `docs/design/Lattice-Owner-Decision-OD-007-M8-Continuity.md`.

## Current role of this document

This document records the Owner-approved M8 milestone architecture and the decomposition used to implement authenticated ownership, explicit preference continuity, and deletion/retention foundations.

It was authored before M8 implementation. M8 has subsequently been implemented and accepted on canonical repository history; fresh canonical source and the derived `docs/ROADMAP.md` control current implementation-status claims.

The stable cross-system maintenance homes are now split deliberately:

- `Lattice-Intent-and-Decision-Architecture.md` — reusable USER preference/intent semantics;
- `Lattice-State-and-Persistence-Architecture.md` — durable ownership, state lifecycle, deletion/purge structure and reconstruction;
- `Lattice-Reliability-and-Recovery-Architecture.md` — reconnect, failure and recovery semantics; and
- `Lattice-Execution-and-Capability-Architecture.md` — generic execution/capability semantics.

This M8 document remains the milestone-specific architecture/provenance source. The design-baseline seam and decomposition below are historical implementation-planning context, not statements that the work is still pending.

## Objective

Add real authenticated ownership, tenant isolation, explicit preference continuity, and deletion/retention foundations around the accepted M7 durable conversation lifecycle without duplicating M7 persistence, progress, or reconnect mechanisms and without transferring semantic authority between Lattice subsystems.

## Design-baseline architecture seam — historical

At the design baseline:

- the HTTP application used `apiSubject` as an offline placeholder and defaulted it to `fixture-user`;
- runtime composition passed `fixture-user` into bounded Intent Authority intake;
- Conversation persistence had identity and creation time but no authenticated owner;
- Run, result, cancellation, progress, and continuity APIs operated on durable IDs without a real authenticated ownership boundary;
- idempotency already had a subject-like scope key that could be rebound to real authenticated subject identity; and
- M7 already provided durable Conversation identity, USER-message provenance, exact IntentVersion/DecisionPlan/Run binding, progress, reconnect, reload reconstruction, and continuation.

These bullets describe the repository state that motivated M8. They are not current-main implementation claims.

M8 therefore added ownership/security and USER preference continuity around the existing graph rather than replacing that graph.

## Target architecture

```text
Authenticated request
        |
        v
AuthenticatedSubject
        |
        +---------------------------+
        |                           |
        v                           v
Conversation ownership       UserPreference state
        |                     (Intent Authority)
        v                           |
existing M7 graph                  |
Conversation                       |
 -> USER messages                  |
 -> IntentScope/Version <----------+
 -> DecisionPlan
 -> Run
 -> progress/events
 -> StructuredDecision
 -> continuity
```

`AuthenticatedSubject` is a request security context, not a Product-semantic authority.

## Core invariants

1. Conversation is the ownership root for conversation-derived durable state.
2. An authenticated subject may access conversation-derived state only when it owns the anchoring Conversation.
3. Authorization failure is fail-closed and must not leak useful cross-user object-existence information.
4. Idempotency is scoped by authenticated subject identity.
5. Reusable account preferences are explicit USER-authored/confirmed Intent Authority state.
6. Preference reuse is copied by value with provenance into exact IntentScope/IntentVersion state.
7. Later preference changes never rewrite historical IntentVersions or Runs.
8. Transcript/model/Solandra inference never silently becomes persistent preference state.
9. Prior external facts never become reusable truth merely through continuity; V36 authority remains unchanged.
10. Deletion immediately removes normal user-facing access while physical purge timing remains governed by separately qualified retention policy.

## Provider-neutral authentication contract

The Product-facing authentication seam exposes the minimum stable identity contract required by M8:

```text
AuthenticatedSubject {
  subjectId
}
```

Authentication-provider details remain outside Product semantic state. Provider claims may be validated and mapped into `subjectId`, but downstream Intent Authority, V36, Decision Engine, Execution Runtime, and Solandra contracts should not depend on provider-specific token structures.

Development-only fixture authentication may remain explicitly available for local/test execution. Any production-capable mode that requires authentication must fail closed when authenticated identity cannot be established.

## Conversation ownership

Conversation is the durable ownership anchor:

```text
Conversation {
  id
  ownerSubjectId
  createdAt
  deletedAt?
}
```

Ownership should normally be derived through Conversation relationships rather than copied as independently mutable ownership fields onto every child row.

Authorization-sensitive storage/query APIs should prove subject ownership as part of retrieval or mutation rather than fetching an unrestricted object and relying on distant caller discipline.

## Preference continuity

The account-level continuity surface is deliberately narrow:

```text
UserPreference {
  preferenceId
  ownerSubjectId
  semanticKey
  value
  provenance
  version
  status
}
```

Only explicit USER-authored or exact USER-confirmed state may enter this surface.

When a saved preference applies to a new decision, Intent Authority copies the applicable value and provenance into the target IntentScope/IntentVersion. The copied IntentVersion is the authoritative decision input. There is no live mutable reference from historical intent to current account preference state.

The permanent semantics of this flow are maintained with the OD-007 decision and `Lattice-Intent-and-Decision-Architecture.md`; this section preserves the M8-specific design basis.

## User controls

Required conceptual user operations:

- remember this preference;
- forget this preference;
- show my saved preferences;
- use this preference for this decision;
- do not use this preference here.

The Product must not expose internal memory machinery as a user requirement.

## Deletion and retention lifecycle

```text
ACTIVE
  -> user deletion
DELETED / inaccessible
  -> separately qualified retention policy
PURGED
```

Deletion immediately blocks normal user-facing access, continuation, new execution, progress reconnect, result access, and mutation for the deleted scope.

M8 supplies the decision/milestone foundation for this lifecycle, not invented retention durations. Cross-system state/persistence and recovery details are maintained in their permanent architecture documents. Retention/purge timing must be separately qualified before implementation treats any duration as policy.

## Historical implementation decomposition

The approved M8 implementation sequence was:

### M8-A — Authenticated subject boundary

- introduce provider-neutral authenticated request subject;
- replace runtime use of `fixture-user` on normal authenticated paths;
- retain only explicit development/test fixture configuration;
- fail closed when authentication is required but absent/invalid.

### M8-B — Conversation ownership

- add immutable Conversation owner subject;
- scope Conversation creation and retrieval by authenticated subject;
- define non-disclosing fail-closed behavior for cross-user access.

### M8-C — Durable graph isolation

Propagate ownership enforcement through:

- USER messages;
- IntentScope/IntentVersion operations;
- DecisionPlan access;
- Run creation/read/cancellation;
- Run events/progress SSE;
- result reads;
- continuity reconstruction and later continuation.

Do not duplicate M7 state or continuity mechanisms.

### M8-D — Subject-scoped idempotency and adversarial isolation

- bind current idempotency scope key to authenticated subject identity;
- add two-subject adversarial probes across every user-data API boundary;
- prove same idempotency key may safely exist independently for different subjects while conflicting bodies still fail within one subject scope.

### M8-E — Explicit preference continuity

- implement versioned USER preference persistence under Intent Authority;
- support list/create/update/revoke semantics under subject ownership;
- copy by value with provenance into exact IntentScope/IntentVersion state;
- preserve historical immutability.

### M8-F — User controls and deletion/retention foundations

- expose Product-level remember/forget/list/apply/exclude preference operations;
- add deletion-state enforcement;
- introduce purge-policy seams without hard-coding unqualified retention periods.

This decomposition is retained to explain how the approved milestone design was sliced. It does not imply these Work Items remain open.

## Validation design

The M8 acceptance design required exact-candidate evidence with at least two authenticated users to prove:

1. cross-user Conversation access fails closed;
2. cross-user messages, intent, plans, Runs, results, cancellation, SSE, and continuity fail closed;
3. subject idempotency isolation behaves correctly;
4. same-user Conversation and preference state survives PostgreSQL/process restart and reconnect;
5. explicit preferences carry forward only through authorized Intent Authority reuse;
6. preference updates/revocation do not rewrite historical IntentVersions/Runs;
7. transcript/model/Solandra inference does not silently become persistent preference state;
8. prior external facts do not silently become reusable V36 truth;
9. deletion immediately prevents normal access/continuation; and
10. Architecture Integrity remains intact.

M8 acceptance was later executed separately from this design record. The exact evidence and current milestone status must be read from the applicable implementation/roadmap evidence rather than inferred from prose here.

## Open implementation-policy questions retained beyond M8

The M8 architecture did not select or invent:

- authentication provider;
- production credential/session transport;
- legal/operational retention durations;
- production audit-log retention; or
- production identity lifecycle/account-recovery policy.

These remain separate policy/production questions unless separately qualified requirements resolve them. Completion of M8 implementation does not silently resolve them.

## Current exit role

This document no longer functions as a “start M8-A next” handoff. Its current role is to preserve the Owner-approved M8 milestone architecture and the rationale/decomposition used to implement it.

For new work:

- use fresh canonical source for current implementation facts;
- use OD-007 for the confirmed preference-continuity decision;
- use the permanent domain architectures for generic intent, state/persistence, reliability and execution semantics; and
- use current qualified requirements for any new authentication, retention, purge or production behavior.

This document does not establish production readiness, provider qualification, retention duration, paid infrastructure authorization, or production deployment authority.
