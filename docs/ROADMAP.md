# Lattice 1.0 Roadmap

Status: **DERIVED EXECUTION VIEW — NON-AUTHORITATIVE**

This file summarizes current milestone position for day-to-day execution. It does not independently create Product requirements, semantic authority, validation, production readiness, provider qualification, or Owner authorization.

## Controlling design and maintenance sources

The canonical 1.0 Product direction and forward milestone sequence are defined by:

- `docs/design/Lattice-Living-Software-Design-to-1.0.md`;
- `docs/design/Lattice-Living-Software-Design-to-1.0-v0.6-amendment.md`;
- `docs/design/Lattice-Living-Software-Design-to-1.0-v0.7-amendment.md`;
- `docs/design/Lattice-Owner-Decisions-OD-001-to-OD-004.md`;
- `docs/design/Lattice-Owner-Decision-OD-007-M8-Continuity.md`;
- `docs/design/Lattice-System-Registry-and-Naming.md`; and
- `docs/design/Lattice-Architecture-Integrity.md`.

`docs/design/README.md` is the non-authoritative design ownership/maintenance map. It identifies where stable cross-system concepts should be maintained without changing the authority status of the underlying design records.

Permanent domain maintenance homes are:

- `docs/design/Lattice-State-and-Persistence-Architecture.md` — durable state, lifecycle, reconstruction and deletion/purge structure;
- `docs/design/Lattice-Intent-and-Decision-Architecture.md` — USER intent, clarification/correction, preference/delegation, evidence-to-decision composition and StructuredDecision semantics;
- `docs/design/Lattice-Execution-and-Capability-Architecture.md` — Run execution, workers, capability licensing, budgets, cancellation, side effects and operational provenance;
- `docs/design/Lattice-Resource-and-Action-Architecture.md` — Resource identity/provenance/validity/hydration and ActionProposal semantics; and
- `docs/design/Lattice-Reliability-and-Recovery-Architecture.md` — failure classes, recovery ownership, retry/replay/reconnect, degraded operation and observability.

These documents retain their own stated status. Their presence does not silently supersede Owner-approved decisions. The protected V36 specification remains controlling for V36 epistemic semantics.

M9-specific live-provider/model route qualification remains in `docs/design/M9-Live-Provider-Promotion-Architecture.md` and its executed qualification records. Generic execution and reliability behavior belongs in the permanent domain architectures rather than being redefined by M9.

The current Solandra primary presentation direction is the Owner-approved `docs/design/solandra/PRIMARY-INTERACTION-CONTRACT.md`, supported by the companion Solandra design documents. The earlier offline prototype package and Knowledge Orbit work remain historical approval/implementation provenance where applicable; they do not override the later Composer/three-phase primary interaction lock.

## Reconciliation baseline

Roadmap reconciled against canonical:

- `main @ 63251dde6cfb6aa08c3a054b24d4ca7d1127bc65`
- tree `18ebbe3e345c1e504316decb599848602c465bcd`

Fresh canonical source controls implementation-status claims. Historical validation remains scoped to the exact revision and execution surface on which it ran; this roadmap does not transfer validation across revisions.

## Authority and status vocabulary

The living design's item-level status vocabulary remains controlling:

- **Confirmed** — authoritative Product design.
- **Working assumption** — may guide reversible work while visibly provisional.
- **Proposed** — recommendation only; does not independently authorize Product mutation.
- **Open decision** — unresolved and blocks dependent work where the controlling design says it does.
- **Deferred** — outside the 1.0 critical path unless separately promoted.

The canonical system names are **Lattice Product**, **Lattice Intent Authority**, **Lattice Execution Runtime**, **Lattice Model Gateway**, **V36 Truth Core**, **Lattice Decision Engine**, **Solandra Experience**, and the external **V7 LLM Simulation Lab**. Implementation modules, stores, workers, adapters, providers, Resources, and UI surfaces do not acquire peer Product authority merely because they are separately named or executable.

## Accepted milestone evidence carried forward

### M7

M7 durable Conversation/progress/reconnect acceptance is historical exact-revision evidence. Canonical `main @ 4d9548b7e8c64b57c60eb37a9e605a1c391b810b` established the PostgreSQL-backed durable Conversation/USER-message/continuity/reconnect stack through M7-G2A. PR #120 subsequently integrated the then-current Knowledge Orbit presentation and real-browser M7-G2C acceptance, and exact-main validation later passed on `4ec9cbcb4faca04896cecac310ed5e5e7e532e26` in GitHub Actions run `33296051622`.

The Knowledge Orbit portion is retained as **historical M7 acceptance provenance only**. Later Owner-approved Solandra design and implementation replaced orbit-first primary presentation with the semantic Composer baseline and the Listen / Current understanding / Provide knowledge interaction lock. That presentation supersession does not invalidate the durable M7 backend/reconnect evidence.

### M8

PR #138 closed the milestone-level M8 acceptance-evidence gaps and was squash-merged as `main @ 4c00db0254b09d120843c61a544cf89be311f6ad`, tree `8688943a2f7efae0fed2750c28c7ca5b73453265`. Exact post-merge Windows Validation, Windows Prototype Validation, native PostgreSQL 18 durability, and durable real-browser lifecycle validation passed on that exact revision.

M8 therefore has bounded acceptance evidence for authenticated subject ownership, derived-object isolation, subject-scoped idempotency, explicit USER-controlled preference continuity, historical IntentVersion/Run immutability, no silent promotion of historical external facts into reusable V36 truth, and deletion-state enforcement. M8 does not establish generalized memory, retention duration, purge execution, provider promotion, production deployment, or production readiness.

## Current position against the living roadmap

| Stage | Milestone | Current roadmap status | Evidence / remaining boundary |
|---|---|---|---|
| Cross-cutting | **Lattice Architecture Integrity** | **ACTIVE / OWNER-APPROVED** | Applies across M3-M12 without consuming a milestone. Preserves Product-semantic authority boundaries. |
| Prototype | **M0 — Product baseline** | **COMPLETE / PROVENANCE-BOUNDED** | Offline V36, durable operational state, Model Gateway boundary and Product baseline capabilities exist in repository history. Exact validation claims remain revision-scoped. |
| Prototype | **M1 — V7 LLM Simulation Lab** | **COMPLETE / EXTERNAL PROTOTYPE ARTIFACT VALIDATED** | Owner-supplied standalone simulator evidence remains prototype evidence only; it does not establish Lattice Product or production correctness. |
| Prototype | **M2 — Solandra Offline Prototype UI Design** | **COMPLETE / OWNER-APPROVED HISTORICAL OFFLINE-PROTOTYPE DESIGN** | The approved archive remains valid approval provenance for its bounded offline-prototype scope. Later Owner-approved Solandra primary-interaction design supersedes conflicting orbit-first/dashboard-first presentation direction without erasing the M2 approval event. |
| Build to 1.0 | **M3 — Lattice Execution Runtime durable composition** | **COMPLETE / EXACT-REVISION ACCEPTED** | Durable API/Run-worker/Research-worker composition, resumable Run coordination and PostgreSQL process boundaries were accepted on their exact milestone revisions. Generic execution semantics are now maintained in `Lattice-Execution-and-Capability-Architecture.md`. |
| Build to 1.0 | **M4 — Durable V36 Truth Core research handshake** | **COMPLETE / EXACT-REVISION ACCEPTED** | Full checkpoint/research continuation is implemented: Runtime executes operational work; V36 alone admits evidence and advances truth. Live-provider qualification remains a separate M9 concern. |
| Build to 1.0 | **M5 — Lattice Intent Authority + clarification + planning** | **COMPLETE / EXACT-REVISION ACCEPTED** | M5-A through M5-K established immutable USER-provenance intent, clarification/correction lineage, exact DecisionPlan/Run binding, supersession and bounded delegation. Permanent semantics are maintained in `Lattice-Intent-and-Decision-Architecture.md`. |
| Build to 1.0 | **M6 — Lattice Decision Engine generalization** | **COMPLETE / EXACT-REVISION ACCEPTED** | Typed/versioned criteria, priority tiers, tri-state hard requirements, material-dominance frontier, structured trade-offs and bounded delegated selection are implemented and accepted at the milestone boundary. |
| Build to 1.0 | **M7 — Conversation + progress API** | **COMPLETE / EXACT-REVISION ACCEPTED** | Durable Conversation, USER-message provenance, SSE reconnect, reload reconstruction and continuation are accepted. Knowledge Orbit is historical presentation provenance, not the current primary UI contract. |
| Build to 1.0 | **M8 — Auth + privacy + continuity** | **COMPLETE / EXACT-REVISION ACCEPTED** | OD-007 explicit preference continuity, authenticated ownership/isolation, subject-scoped idempotency, deletion enforcement and continuity controls have bounded exact-revision acceptance. |
| Build to 1.0 | **M9 — Live-provider promotion** | **IN PROGRESS / M9-4 BOUNDED LIVE ROUTE QUALIFIED / OD-005 PARTIALLY BLOCKING** | M9-1 invocation provenance, M9-2 capability execution policy and M9-3 bounded external context projection are present in canonical history. M9-4 has qualified a pinned zero-cost `LIVE_DIRECT` NVIDIA NIM development route using `nvidia/nemotron-3.5-lightning-30b-a3b` with 18/18 live behavioral passes under synthetic/non-sensitive input restrictions. This does not authorize production routing/data or automatic fallback. M9-5 durable live research is the next unclosed milestone slice; M9-6 routing/fallback promotion remains blocked on OD-005; M9-7 integrated acceptance follows. |
| Build to 1.0 | **M10 — Solandra Experience 1.0 explanation** | **PARTIAL / PRIMARY INTERACTION LOCKED / OD-006 BLOCKS GENERALIZED EXPLANATION** | The semantic Solandra baseline replaced Knowledge Orbit in active presentation, and the Owner-approved primary interaction is now Conversation + ConversationInput + Composer with exactly Listen / Current understanding / Provide knowledge. Resource presentation and reliability presentation have permanent application-level semantic owners. OD-006 generalized model-assisted explanation licensing/fidelity and its milestone acceptance remain unresolved; current presentation progress does not complete M10. |
| Production / release | **M11 — Production operations** | **BLOCKED** | Requires Owner-bound production topology/SLO/backup/limit/security/rollback decisions and operational acceptance. Completion of M8/M9 development surfaces does not authorize production deployment. |
| Production / release | **M12 — 1.0 stabilization** | **BLOCKED** | Requires all applicable release gates on one exact release candidate, including AIC-R1, plus resolution/acceptance of release-blocking open decisions. |

## Confirmed Product decisions controlling forward work

- **OD-001 — RESOLVED / CONFIRMED:** Lattice 1.0 is a **Trusted Decision Product**. Guaranteed journey: natural-language goal → authoritative intent → material clarification when necessary → bounded research → V36 verification → authoritative decision → faithful Solandra explanation → conversational continuation.
- **OD-002 — RESOLVED / CONFIRMED:** V36 yields immutable continuation state and research requests; Execution Runtime durably executes/persists operational results; only V36 resumes epistemic state. Operational inability is not epistemic judgment.
- **OD-003 — RESOLVED / CONFIRMED:** one Decision Engine with qualified typed/versioned Criterion Catalog, USER priority tiers, tri-state hard requirements, layered tolerance ownership, material-dominance frontier, no forced #1 and explicit bounded final-choice delegation.
- **OD-004 — RESOLVED / CONFIRMED:** transcript is context/provenance; immutable versioned structured intent is authority; canonical mutation requires USER-origin meaning or exact proposal-bound confirmation; corrections preserve lineage; DecisionPlans/Runs bind exact intent versions; delegation is explicit and bounded.
- **OD-007 — RESOLVED / CONFIRMED:** Lattice 1.0 continuity is explicit USER-authored/confirmed preference continuity, not generalized conversational memory. Reuse is visible, revocable, versioned and provenance-preserving; transcript/model/Solandra inference and historical external facts do not silently become reusable memory/truth.

Still unresolved where not separately qualified:

- **OD-005:** first qualified provider/routing policy. M9-4 bounded route qualification does not itself resolve Product routing/fallback policy.
- **OD-006:** generalized Solandra explanation licensing/fidelity contract.
- **OD-008 through OD-010:** retain their living-design status unless separately resolved by qualified authority.

## Current implementation sequence

1. **Preserve completed M3-M8 mechanisms.** Do not rebuild durable execution, V36 continuation, Intent Authority, Decision Engine, Conversation/reconnect, authenticated ownership or explicit preference continuity under new names.
2. **Use permanent domain architectures for generic semantics.** New persistence, intent/decision, execution/capability, Resource/Action and reliability behavior should reconcile to their designated maintenance homes rather than being specified ad hoc inside M9, Solandra, or the roadmap.
3. **M9-5 — durable live research through Execution Runtime and V36.** Reuse the already-qualified bounded M9-4 live route only within its synthetic/non-sensitive development boundary. Provider success remains operational evidence; V36 remains factual admission authority.
4. **M9-6 — routing/fallback promotion only after OD-005.** Qualification of one pinned route does not authorize autonomous provider selection or failover policy.
5. **M9-7 — integrated exact-revision Product acceptance.** Validate the complete promoted M9 path on the exact candidate without transferring provider/model authority into Product semantics.
6. **M10 — continue presentation work only within current semantic owners while OD-006 remains unresolved.** The primary interaction lock may be implemented/refined without inventing generalized explanation licensing. Resources remain governed by Resource/Action architecture; failure/recovery presentation remains governed by Reliability/Recovery; truth/decision/intent remain upstream authorities.
7. **M11 — bind production operations explicitly.** Production topology, SLOs, backups, security, data/provider policy, limits, rollback and deployment require their own qualified decisions and Owner authorization.
8. **M12 — stabilize one exact release candidate.** Execute all applicable release gates, including Architecture Integrity, without transferring validation from prior revisions.

## Critical dependency snapshot

```text
COMPLETE: M0 Product baseline + M1 V7 Simulation Lab + M2 offline UI design provenance
                                      |
                                      v
COMPLETE: M3 Execution Runtime durable composition
                                      |
                                      v
COMPLETE: M4 Durable V36 research handshake
                                      |
                                      +------------------> M9 Live-provider promotion
                                      |                    M9-1 provenance          present
                                      |                    M9-2 capability policy   present
                                      |                    M9-3 context/privacy     present
                                      |                    M9-4 pinned live route   QUALIFIED
                                      |                    M9-5 durable live V36    NEXT
                                      |                    M9-6 routing/fallback    BLOCKED ON OD-005
                                      |                    M9-7 integrated accept   PENDING
                                      |
                                      v
COMPLETE: M5 Intent Authority/planning
                                      |
                                      v
COMPLETE: M6 Decision Engine generalization
      -> M10 Solandra Experience — primary interaction locked; generalized explanation blocked on OD-006
                                      |
                                      v
COMPLETE: M7 Conversation + Progress API
                                      |
                                      v
COMPLETE: M8 Auth/privacy/explicit preference continuity
                                      |
                                      v
CURRENT PRODUCT FRONTIER: M9-5 durable live research through Execution Runtime + V36

M7 Conversation/progress + M8 authenticated continuity
----------------------------------------> M11 Production operations

All paths --------------------------------------------> M12 1.0 stabilization
```

## Execution handoff readiness

Execution handoffs are coordination artifacts, not Product authority. They must be rebound against fresh canonical GitHub state and qualified Product sources before reuse.

| Handoff | Readiness | Boundary |
|---|---|---|
| **M5 Intent Authority implementation handoff** | **HISTORICAL / COMPLETED** | Retain as implementation provenance only. |
| **M6 Decision Engine implementation handoff** | **HISTORICAL / COMPLETED** | Retain as bounded execution/acceptance provenance only. |
| **M7 Conversation + Progress API handoff** | **HISTORICAL / COMPLETED** | Backend/reconnect evidence remains useful; orbit-first presentation details are historical and subordinate to later Solandra design. |
| **M8 Auth + privacy + continuity acceptance** | **HISTORICAL / COMPLETED** | Records the OD-007 acceptance matrix and exact-candidate closure boundary; does not authorize M9, production, generalized memory or retention/purge policy. |
| **M9-4 live provider qualification packet** | **CURRENT BOUNDED QUALIFICATION EVIDENCE** | `docs/development/m9-4-nvidia-nemotron-3.5-lightning-qualification-2026-08-31.md` qualifies one pinned zero-cost development route with synthetic/non-sensitive inputs only. It is reusable evidence while its exact qualification dependencies remain materially unchanged. |

## Historical milestone numbering and validation rule

Earlier repository/specification milestone labels and development-session labels remain provenance only. Forward planning uses the living-design M0-M12 sequence; Architecture Integrity is cross-cutting and does not consume a milestone number.

Do not reinterpret prior validation across revisions. A merge establishes transition success. A matching tree establishes only the exact reproducible tree relation demonstrated. A revision is validated only by exact-revision validation or by a fully established cross-revision equivalence that includes all relevant non-tree inputs and execution contracts.
