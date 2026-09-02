# Lattice Owner Decision — OD-007 / M8 Continuity

Status: **OWNER-APPROVED PRODUCT DESIGN**

Approved: **August 30, 2026**

Repository design baseline: `main @ 7e4932f443c5f19286c6e50f3bf702f1f356739b`.

Applies to: **M8 — Auth + privacy + continuity**.

## 1. Decision

For Lattice 1.0, cross-conversation continuity is **explicit preference continuity, not generalized conversational memory**.

Persistent cross-conversation user state is limited to explicit USER-authored or exact USER-confirmed preference state owned by **Lattice Intent Authority**.

Lattice must not automatically promote transcript text, model inference, Solandra summaries, historical V36 evidence, historical recommendations, inferred personality, or prior external-world facts into account-level reusable memory.

Preference reuse is visible, revocable, versioned, and copied by value with provenance into an exact IntentScope/IntentVersion when it is used. Later changes to the account-level preference do not mutate historical IntentVersions or historical Runs.

This decision resolves OD-007 at the Product-design level. It does not claim implementation, validation, production readiness, or provider qualification.

## 2. Product rationale

The M8 continuity requirement should reduce the user burden of repeatedly restating stable preferences without introducing an opaque memory subsystem that weakens intent, truth, privacy, or user-control boundaries.

This follows the foundational Product filter:

- remove the barrier of unnecessary repetition;
- preserve necessary privacy, authorization, provenance, and semantic-authority boundaries;
- keep internal machinery hidden from the user;
- prefer the simplest architecture that delivers the governed Product outcome.

## 3. Semantic ownership

### Authentication

Authentication establishes the current request subject. Authentication does not acquire Lattice Product-semantic authority.

A provider-neutral request context should expose at minimum:

```text
AuthenticatedSubject {
  subjectId
}
```

JWTs, cookies, OAuth claims, external identity-provider schemas, and provider-specific credentials remain authentication mechanisms and must not leak into canonical Intent Authority, V36, Decision Engine, or Solandra semantics.

### Conversation ownership

Conversation is the ownership root for the durable M7 conversation graph.

Conceptually:

```text
Conversation {
  id
  ownerSubjectId
  createdAt
  deletedAt?
}
```

Conversation ownership gates access to conversation-derived state including messages, IntentScopes/IntentVersions, DecisionPlans, Runs, progress/events, results, and continuity reconstruction.

A caller must not read, mutate, cancel, stream, continue, or delete conversation-derived state unless the authenticated subject owns the Conversation anchoring that state.

### Preference continuity

Account-level preference continuity remains under **Lattice Intent Authority** because it represents reusable USER intent, not truth or presentation state.

Conceptually:

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

A reusable preference may be copied into a new IntentScope only with preserved USER provenance and explicit applicability. The new IntentVersion becomes authoritative for that decision. The account-level preference remains a separate source object rather than a live mutable reference.

## 4. Prohibited authority transfers

M8 must preserve the following prohibitions:

- authentication state does not become USER intent;
- transcript text does not silently become persistent preference state;
- model or Solandra inference does not silently become USER preference;
- prior external facts do not become reusable truth merely because they appeared in a prior conversation;
- preference continuity does not bypass exact IntentVersion binding;
- conversation ownership does not move truth, decision, execution, or presentation authority;
- deletion status does not rewrite historical provenance while retained historical state still exists.

## 5. User controls

The Product should expose continuity through ordinary user-facing controls rather than internal memory-management machinery.

Required conceptual operations are:

- remember this preference;
- forget this preference;
- show my saved preferences;
- use this preference for this decision;
- do not use this preference here.

The user should not need to manage embeddings, retrieval collections, vector stores, model context windows, memory classes, or provider-specific state.

## 6. Deletion and retention foundation

M8 separates immediate user-access deletion from later physical purge policy.

Conceptually:

```text
ACTIVE
  -> user deletion
DELETED / inaccessible
  -> retention policy
PURGED
```

Deletion must immediately prevent normal user-facing access, continuation, execution, progress-stream reconnection, result access, and mutation for the deleted object scope.

Exact retention durations are not established by this decision. They require separately qualified legal/operational Product policy. M8 should provide the structural lifecycle needed to enforce such a policy without inventing one.

Any retained audit/provenance record must remain minimal, justified, and semantically distinguishable from active user-accessible Product state.

## 7. M8 architecture sequence

The recommended implementation decomposition is:

1. **M8-A — Authenticated subject boundary**
   - replace the fixture subject with a provider-neutral authenticated request subject;
   - retain only an explicitly development-only fixture path;
   - fail closed when authentication is required and unavailable.

2. **M8-B — Conversation ownership**
   - add immutable subject ownership to Conversation;
   - make subject-scoped Conversation creation/read the root authorization invariant.

3. **M8-C — Durable graph isolation**
   - enforce Conversation ownership through messages, IntentScope/IntentVersion, DecisionPlan, Run, result, cancellation, progress SSE, and continuity reconstruction;
   - avoid duplicating M7 persistence/continuity mechanisms.

4. **M8-D — Subject-scoped idempotency and adversarial isolation**
   - bind existing idempotency scope to authenticated subject identity;
   - prove cross-user access fails closed.

5. **M8-E — Explicit preference continuity**
   - add versioned USER preference state under Intent Authority;
   - copy by value with provenance into exact IntentScope/IntentVersion state;
   - preserve historical immutability when preferences change.

6. **M8-F — User controls and deletion/retention lifecycle**
   - expose remember/forget/list/apply/exclude preference controls;
   - add deletion-state and purge-policy foundations without inventing retention durations.

## 8. Acceptance design

M8 implementation acceptance should use at least two independently authenticated subjects and prove, on one exact candidate revision, that:

- cross-user Conversation reads fail closed;
- cross-user message, intent, DecisionPlan, Run, result, cancellation, progress/SSE, and continuity access fail closed;
- subject-scoped idempotency does not collide across users;
- same-user state survives process/PostgreSQL restart and reconnect;
- explicit saved preferences carry forward only when applicable/authorized;
- preference changes do not rewrite historical IntentVersions or Runs;
- transcript/model/Solandra inference does not silently become persistent preference state;
- historical external facts do not silently become reusable V36 truth;
- deletion immediately removes user-facing access and continuation while preserving any separately justified retention-state distinction;
- Architecture Integrity remains intact across Intent Authority, Execution Runtime, V36, Decision Engine, and Solandra.

Passing design review does not satisfy these acceptance criteria; they require exact implementation evidence.

## 9. Non-decisions

This decision does not:

- select an authentication provider;
- define production identity-provider configuration;
- authorize paid identity infrastructure;
- set legal/operational retention durations;
- define production logging/SIEM policy;
- resolve OD-005 provider routing;
- resolve OD-006 Solandra explanation licensing;
- authorize live-provider promotion, production deployment, or production data migration;
- create generalized conversational memory for Lattice 1.0.

## 10. Design status

**OD-007 — RESOLVED / CONFIRMED PRODUCT DESIGN.**

M8 remains unimplemented until separately bound Product Work Items execute against fresh canonical source and exact validation evidence is produced.
