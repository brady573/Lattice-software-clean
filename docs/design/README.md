# Lattice Design Document Ownership Map

Status: **NON-AUTHORITATIVE DESIGN INDEX / MAINTENANCE MAP**

Audited against canonical repository state: `main @ 498a0bb69aba9f55e2a6c8357248d4331e39d9cc`, tree `60ed5ad18f2eef59db434a88bfa6fe8e501e3515`.

Audit date: **August 31, 2026**.

## 1. Purpose

This file answers one maintenance question:

> **When a Lattice design concept changes, which document is the right place to maintain it?**

It is a navigation and anti-drift aid only. It does **not** create Product requirements, elevate a draft over an Owner-approved decision, alter the status of another document, transfer semantic authority, or replace fresh repository inspection.

The Lattice design corpus contains several legitimate kinds of records:

- foundational Product principles;
- Owner-approved architecture controls and naming conventions;
- Owner decision records;
- the living 1.0 Product direction and its amendments;
- permanent cross-system architecture documents;
- milestone/provider architecture;
- current-implementation structural maps;
- Solandra interaction/UI specifications and acceptance records; and
- historical approval/provenance records.

Those records may repeat a rule when a downstream document needs the rule for context. Repetition is acceptable when the semantic owner is explicit and the downstream copy does not become a competing specification.

## 2. Authority is not the same as maintenance ownership

A newer or more specialized document is not automatically higher authority.

In particular:

- explicit Owner-confirmed decision records retain the authority established by their own status and provenance;
- protected V36 specifications remain controlling for V36 epistemic semantics;
- the Living Software Design and confirmed amendments retain their approved Product-definition, decision, and sequencing authority at their stated item-level status;
- permanent cross-system architecture documents are the preferred **maintenance homes** for their stable domains at each document's existing status;
- a `RECONCILED DRAFT` does not silently supersede an Owner-approved design merely because it is newer or more detailed;
- milestone/provider designs may narrow a permanent architecture for that milestone, but should not redefine generic semantics unless separately qualified authority does so; and
- implementation presence, roadmap text, UI placement, persistence location, or provider behavior does not by itself transfer Product authority.

When two documents materially conflict, resolve the conflict through the applicable authority/status and fresh canonical source. Do not choose a winner from filename, recency, or document length alone.

## 3. Product-wide design hierarchy by responsibility

| Responsibility | Primary maintenance home | Notes |
|---|---|---|
| First Product-design filter / philosophy | `Lattice-Foundational-Design-Principle.md` | Owner-approved Product-wide filter: remove unnecessary barriers while preserving necessary boundaries. |
| Cross-cutting semantic ownership and anti-drift invariants | `Lattice-Architecture-Integrity.md` | Owner-approved architecture control. Does not replace subsystem semantics. |
| Canonical subsystem names and naming grammar | `Lattice-System-Registry-and-Naming.md` | Owner-approved naming/architecture-boundary convention. |
| 1.0 Product definition, forward direction, milestone sequencing, unresolved decisions | `Lattice-Living-Software-Design-to-1.0.md` plus approved amendments and applicable Owner decision records | Living design remains the direction/sequence record at its stated item-level statuses. Stable domain detail should be maintained in permanent architecture documents rather than continually expanding the living design. |
| Current implementation structural map | `Lattice-System-Architecture.md` | A structural snapshot at its explicit repository baseline. Fresh canonical source controls freshness-sensitive implementation claims after that baseline. |
| Durable state, persistence, reconstruction, lifecycle, deletion/purge structure, second-source-of-truth rules | `Lattice-State-and-Persistence-Architecture.md` | Cross-system persistence maintenance home. More-specific semantic owners still define what persisted state means. |
| USER intent, clarification/confirmation/correction, preference/delegation semantics, criteria/decision/frontier/selection semantics | `Lattice-Intent-and-Decision-Architecture.md` | Maintains the permanent semantic composition. OD-001 through OD-004 and OD-007 retain their decision-record authority. |
| Run execution, workers/tasks, capability licensing, budgets, side effects, cancellation, generic retry/idempotency and operational provenance | `Lattice-Execution-and-Capability-Architecture.md` | Permanent generic execution model. Provider-specific qualification belongs in M9. Reliability-wide recovery semantics also reconcile to the reliability architecture. |
| Resource identity/version, provenance, subject/basis binding, validity/relevance, hydration, prepared assistance and `ActionProposal` semantics | `Lattice-Resource-and-Action-Architecture.md` | Application-level Resource/Action maintenance home. Solandra documents control how Resources are presented, not what makes them valid or executable. |
| Failure classes, recovery ownership, retry boundaries across subsystems, replay/reconnect, duplicate suppression, degraded operation, Product-visible reliability state and observability | `Lattice-Reliability-and-Recovery-Architecture.md` | Permanent reliability maintenance home. Subsystems retain their own state/semantic authority. |
| M8-specific authentication, Conversation ownership, explicit preference continuity and deletion/retention foundation | `Lattice-Owner-Decision-OD-007-M8-Continuity.md` + `M8-Auth-Privacy-Continuity-Architecture.md` | Milestone/decision-specific source. Generic persistence, intent and recovery behavior belongs in permanent domain architectures. |
| M9 live-provider/model route qualification, requested/actual route provenance, local/brokered/direct qualification, provider privacy/retention/fallback evidence | `M9-Live-Provider-Promotion-Architecture.md` | Provider-promotion-specific. Generic execution and reliability semantics belong in permanent architecture documents. |
| Solandra primary interaction and presentation | `solandra/PRIMARY-INTERACTION-CONTRACT.md` plus the Solandra presentation documents listed below | Presentation-only authority. It must project, not redefine, Intent Authority, V36, Decision Engine, Resource/Action, execution or reliability semantics. |

## 4. Owner decision and living-design records

### `Lattice-Living-Software-Design-to-1.0.md`

Role: Owner-approved living Product direction and 1.0 sequencing baseline with item-level status.

Keep here:
- Product-level 1.0 direction;
- milestone sequencing;
- Confirmed / Working assumption / Proposed / Open decision / Deferred status;
- broad cross-milestone rationale.

Do not use it as the long-term detailed specification for domains that now have dedicated architecture documents. Historical baseline implementation descriptions remain provenance, not current-main evidence.

### `Lattice-Living-Software-Design-to-1.0-v0.6-amendment.md`

Role: Owner-approved amendment resolving OD-001 through OD-004 into the living design.

Keep as decision/design provenance. Detailed ongoing intent/decision semantics are maintained in `Lattice-Intent-and-Decision-Architecture.md` subject to the authority of the Owner decision record.

### `Lattice-Living-Software-Design-to-1.0-v0.7-amendment.md`

Role: Owner-approved amendment recording OD-007 explicit preference continuity.

Its original preimplementation sequence is historical design provenance. Current M8 implementation status is obtained from fresh canonical source and the derived roadmap; permanent continuity semantics are maintained in applicable state/persistence, intent/decision and reliability architectures.

### `Lattice-Living-Software-Design-to-1.0-v0.8-amendment.md`

Role: Owner-approved Solandra interaction correction retiring the former fixed presentation-stage/global-gate model from current Product direction.

It establishes continuous Conversation + adaptive Composer as the controlling presentation direction and marks conflicting older Living Design presentation language as historical provenance only. It does not alter Intent Authority, V36, Decision Engine, Resource/Action, execution, or authorization semantics.

### `Lattice-Owner-Decisions-OD-001-to-OD-004.md`

Role: Owner-confirmed Product design decision record.

Do not delete confirmed decision content merely because a later permanent architecture restates it. Later architecture should point back to this record when relying on those decisions.

### `Lattice-Owner-Decision-OD-007-M8-Continuity.md`

Role: Owner-approved Product decision for 1.0 cross-conversation continuity.

Owns the decision that continuity is explicit USER-authored/confirmed preference continuity rather than generalized conversational memory. Implementation and cross-system persistence/recovery details live in their domain documents.

## 5. Permanent architecture documents

### `Lattice-Architecture-Integrity.md`

Cross-cutting invariant/control document. Keep semantic-owner boundaries here; avoid duplicating detailed subsystem mechanics.

### `Lattice-System-Registry-and-Naming.md`

Canonical naming registry. Keep naming and canonical subsystem ownership vocabulary here; implementation components such as plans, stores, workers and adapters do not become peer authorities through naming.

### `Lattice-System-Architecture.md`

Concise implementation composition map. Keep structural relationships here. Treat its repository baseline as the freshness boundary; do not use an older structural snapshot to assert exact current-main implementation state without re-inspection.

### `Lattice-State-and-Persistence-Architecture.md`

Keep durable-state classes, ownership roots, lifecycle/reconstruction, version/checkpoint rules, deletion/purge structure and second-source-of-truth prevention here. Persistence-specific failure behavior may be described here, but generic cross-subsystem failure/recovery taxonomy belongs in Reliability and Recovery.

### `Lattice-Intent-and-Decision-Architecture.md`

Keep the permanent semantic path from USER expression through canonical IntentVersion and DecisionPlan to admitted evidence, criteria, Decision Engine and StructuredDecision here. It may describe presentation constraints only far enough to protect semantic fidelity; Solandra UI behavior belongs in the Solandra contracts.

### `Lattice-Execution-and-Capability-Architecture.md`

Keep generic execution semantics here. Do not let M9/provider implementation become the generic execution specification. Reliability-wide failure/recovery behavior should be referenced from `Lattice-Reliability-and-Recovery-Architecture.md` rather than independently expanded here.

### `Lattice-Resource-and-Action-Architecture.md`

Keep the application Resource/Action model here. Solandra may decide where/how a current Resource appears, but Resource provenance, version, validity, subject ownership, hydration and ActionProposal/execution separation belong here.

### `Lattice-Reliability-and-Recovery-Architecture.md`

Keep cross-system reliability semantics here. Observability is diagnostic/projection state and never becomes authority or the sole recovery record.

## 6. Milestone/provider architecture

### `M8-Auth-Privacy-Continuity-Architecture.md`

Role: Owner-approved M8 milestone architecture and implementation decomposition.

Its preimplementation seam/decomposition is retained as baseline provenance. M8 is no longer a pending milestone on current canonical history; generic durable state, intent and recovery semantics should be maintained in permanent architecture documents rather than copied forward into this M8 file.

### `M9-Live-Provider-Promotion-Architecture.md`

Role: implementation-ready provider-promotion architecture at its stated baseline/status.

Keep provider/model qualification, route classes/provenance, provider privacy/retention qualification and provider-specific promotion here. Current implementation progress is a freshness-sensitive repository/roadmap fact, not something inferred from this document's original planning language.

### Removed: `M8-Design-Integration-Note.md`

This was a non-authoritative temporary discoverability note whose only purpose was to bridge PR #125 while the M8 design files were not yet on `main`. Once those files were integrated, retaining the note made repository state less accurate rather than more discoverable.

## 7. Solandra design ownership

The Solandra folder contains multiple complementary records. They should not be collapsed into one giant UI file because interaction, layout, visual vocabulary and acceptance have different maintenance needs.

### `solandra/PRIMARY-INTERACTION-CONTRACT.md`

Controlling current primary-interaction rule. Owns Conversation + ConversationInput + Composer, continuous interaction, content licensing, reversibility, and primary anti-drift rules.

It does **not** create USER intent, truth, decision, Resource validity, execution authority or reliability state.

### `solandra/CONVERSATION-FLOW.md`

Owns continuous conversational progression, clarification, information gathering, content-specific licensing, uncertainty routing, correction/reversal, and conversation-input behavior. It does not define a fixed user-facing presentation sequence.

### `solandra/UI-DESIGN.md`

Owns concrete screen composition and rendering behavior. It may describe how Resources, failure/recovery information or evidence appear, but application Resource semantics belong in `Lattice-Resource-and-Action-Architecture.md` and Product-visible reliability semantics belong in `Lattice-Reliability-and-Recovery-Architecture.md`.

### `solandra/UNIVERSAL-UI-DESIGN.md`

Owns domain-independent primary UI rules. Examples are fixtures, not Product schema.

### `solandra/BASELINE-LAYOUT-INVARIANTS.md`

Owns geometry and responsive layout invariants only. Resource takeover rules here are geometry, not Resource lifecycle or authorization semantics.

### `solandra/DESIGN.md`

Owns visual tokens and semantic component vocabulary. It does not own upstream Product semantics.

### `solandra/ACCEPTANCE.md`

Owns Solandra black-box presentation/interaction acceptance intent, including continuous adaptive Composer behavior and the prohibition on fixed presentation-stage/global-gate interaction. Acceptance scenarios may project upstream semantics but cannot redefine them. Executed evidence is required on an exact candidate.

### `solandra/APPROVAL.md`

Historical Owner approval/provenance record for the offline-prototype package. Preserve the archive identity and approval history. Later approved primary-interaction contracts supersede conflicting presentation mechanics without erasing the historical approval event.

### `solandra/UX-CONTRACT.md`

Historical offline-prototype UX contract plus still-useful accessibility/input/recovery presentation constraints. Its former orbit-first and staged-presentation mechanics are superseded by the August 31 primary interaction lock and later Owner correction. Retain historical package provenance while using current Composer terminology and precedence.

### `solandra/premium-ui.json`

Support/configuration artifact for design tooling. It is not Product-semantic or interaction authority.

## 8. Cross-document projection rules

A downstream document may repeat an upstream rule when needed for comprehension or local validation, but it should identify the upstream semantic owner.

Examples:

- Solandra may say a multi-option frontier must stay multi-option, but Decision Engine semantics remain owned by the Intent/Decision architecture and applicable Owner decisions.
- Solandra may say a substantial Resource takes over the Composer, but Resource validity/provenance/hydration remain owned by Resource/Action architecture.
- State/Persistence may say a retry cannot assume an uncommitted write succeeded, but generic retry/recovery classification belongs in Reliability/Recovery.
- M9 may say provider timeout creates ambiguity, but generic ambiguous-completion and retry semantics belong in Execution/Capability and Reliability/Recovery.
- Reliability may refer to deletion/subject state during recovery, but ownership/deletion meaning remains with the applicable authenticated ownership/state design.

If a repeated rule starts acquiring independent enums, lifecycle states, authorization semantics or competing ownership language, move the generic rule to its maintenance home and leave a narrow reference/projection in the downstream document.

## 9. Freshness and historical-state rule

Design documents often describe the repository state that existed when they were authored. Preserve those baseline statements as provenance unless they are written as an unqualified current claim.

For freshness-sensitive questions such as “is M8 implemented?”, “what does current `main` do?”, “which provider route is qualified now?” or “what is the current UI implementation?”, use fresh canonical repository evidence and the derived roadmap where appropriate.

A milestone design's old implementation plan does not revert completed Product work. A current implementation does not silently rewrite the historical design record that preceded it.

## 10. Anti-drift checklist for future design work

Before adding or materially expanding a design document:

1. Identify the semantic/architectural maintenance home for the concept.
2. Determine whether a new document is needed or whether the change belongs in an existing owner.
3. If a milestone/provider/UI document repeats a generic rule, reference the permanent owner rather than creating a parallel specification.
4. Preserve Owner decision records and historical approval records as provenance.
5. Do not convert an old baseline implementation statement into a current-main claim.
6. Keep presentation, persistence, execution, reliability, truth, intent and decision authority separate.
7. Reconcile material conflicts explicitly; do not rely on recency or filename to transfer authority.
8. Update this map when a genuinely new stable design domain is introduced.
