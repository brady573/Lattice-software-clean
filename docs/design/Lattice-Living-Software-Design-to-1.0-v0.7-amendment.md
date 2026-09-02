# Lattice Living Software Design to 1.0 — v0.7 Amendment

Status: **OWNER-APPROVED CANONICAL LIVING-DESIGN AMENDMENT — MERGED**

Date: **2026-08-30**

Design baseline: `main @ 7e4932f443c5f19286c6e50f3bf702f1f356739b`.

Amends: `docs/design/Lattice-Living-Software-Design-to-1.0.md` v0.5 as previously amended by v0.6.

Detailed decision record: `docs/design/Lattice-Owner-Decision-OD-007-M8-Continuity.md`.

## Authority and boundary

The Owner explicitly approved the OD-007 direction on August 30, 2026: Lattice 1.0 cross-conversation continuity is explicit preference continuity, not generalized conversational memory.

This amendment records that Product-design decision in canonical repository history. It was authored before M8 implementation; its preimplementation sequence below is retained as design provenance rather than as a claim about current implementation status.

As of the September 1, 2026 design-document audit, M8 has subsequently been implemented and accepted on canonical repository history. Fresh canonical source and the derived `docs/ROADMAP.md` control freshness-sensitive implementation-status claims. The stable cross-system maintenance homes for continuity-related semantics are now also:

- `Lattice-Intent-and-Decision-Architecture.md` for reusable USER preference/intent semantics;
- `Lattice-State-and-Persistence-Architecture.md` for durable ownership, lifecycle, deletion/purge structure and reconstruction; and
- `Lattice-Reliability-and-Recovery-Architecture.md` for reconnect/recovery/failure semantics.

Those later documents do not erase or downgrade the Owner-approved OD-007 decision recorded here.

This is design authority only. It does not by itself establish implementation, validation, production readiness, authentication-provider selection, retention periods, paid infrastructure authorization, or live-provider promotion.

## Amendment A — OD-007 is resolved

The v0.5/v0.6 statements that OD-007 cross-conversation memory scope and user controls remain open are superseded by the following confirmed Product design:

> **For Lattice 1.0, cross-conversation continuity is explicit preference continuity, not generalized conversational memory. Persistent cross-conversation user state is limited to explicit USER-authored or exact USER-confirmed preference state owned by Lattice Intent Authority. Reuse is visible, revocable, versioned, and copied by value with provenance into exact IntentScope/IntentVersion state. Transcript/model/Solandra inference and historical external facts do not silently become reusable memory or truth.**

The controlling Owner decision is `Lattice-Owner-Decision-OD-007-M8-Continuity.md`. The M8-specific architecture is recorded in `M8-Auth-Privacy-Continuity-Architecture.md`; permanent cross-system details are maintained in the domain architectures identified above.

## Amendment B — M8 design dependency and historical implementation sequence

At this amendment's design baseline, M8 was **NOT IMPLEMENTED** and its Product-design dependency for cross-conversation continuity had just been resolved.

The approved implementation sequence at that time was:

1. M8-A — authenticated subject boundary;
2. M8-B — Conversation ownership;
3. M8-C — durable graph isolation;
4. M8-D — subject-scoped idempotency and adversarial isolation;
5. M8-E — explicit preference continuity under Intent Authority;
6. M8-F — user controls and deletion/retention lifecycle foundations.

That sequence is historical design provenance. M8 was later implemented and accepted; do not use this section to infer current implementation status or to re-open completed slices.

M8 was required to reuse M7 durable Conversation/progress/continuity mechanisms rather than duplicate them. That architectural constraint remains relevant wherever the corresponding current implementation still composes through those mechanisms.

## Amendment C — semantic ownership

Authentication establishes request identity but does not become Product-semantic authority.

Conversation is the ownership root for the M7/M8 durable conversation graph. Subject ownership gates access to messages, IntentScopes/IntentVersions, DecisionPlans, Runs, progress/events, results, and continuity reconstruction.

Account-level reusable preferences are Intent Authority state. When applied to a decision, they are copied by value with USER provenance into the exact IntentScope/IntentVersion used by downstream work. Later preference changes cannot mutate historical intent or Run bindings.

V36 remains the sole authority for reusable external factual truth. Prior conversation facts do not become current truth through continuity.

## Amendment D — user control

The Product should expose ordinary operations such as remember, forget, list, apply, and exclude preference state. It should not require users to manage embeddings, vector stores, retrieval collections, context windows, memory classes, or provider-specific state.

## Amendment E — deletion and retention

M8 structurally distinguishes immediate user-access deletion from later physical purge:

```text
ACTIVE
  -> user deletion
DELETED / inaccessible
  -> qualified retention policy
PURGED
```

Exact retention periods remain unresolved policy unless separately qualified and must not be invented from this amendment.

## Amendment F — decision register

Add to resolved decisions:

| ID | Status | Controlling decision |
|---|---|---|
| OD-007 | **RESOLVED / CONFIRMED** | Lattice 1.0 uses explicit USER-authored/confirmed preference continuity under Intent Authority; no generalized conversational memory; reuse is versioned, revocable, provenance-preserving, and copied by value into exact IntentScope/IntentVersion state; transcript/model/Solandra inference and prior external facts do not silently become reusable memory/truth. |

OD-005, OD-006, and OD-008 through OD-010 retain their prior status unless separately resolved by qualified authority.

## Anti-drift audit

This amendment does not:

- duplicate or replace M7 Conversation/progress/continuity mechanisms;
- transfer intent authority to authentication, transcript, model output, or Solandra;
- transfer truth authority away from V36;
- transfer decision authority away from the Decision Engine;
- select an authentication provider;
- set retention durations;
- authorize production deployment, production data migration, paid infrastructure, or live-provider access; or
- transfer current implementation-status authority into this historical design amendment.

At the time it was authored, this amendment did not claim M8 implementation or validation. Later implementation and acceptance are separate repository facts and do not retroactively change the authority/provenance of the OD-007 decision recorded here.
