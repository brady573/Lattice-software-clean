# Lattice Owner Decisions OD-001 through OD-004

Status: **OWNER-CONFIRMED PRODUCT DESIGN DECISION RECORD; OD-001 RECONCILED SEPTEMBER 3, 2026**

Date reconciled: **2026-08-27**

Repository reconciliation baseline: `main @ 59ad7bab970171b696aa853ff1a56e242e13f7c7`

Authority: explicit Owner decisions incorporated into canonical Product design. `The-Core-Lattice-Philosophy.md` is the higher Product authority and first filter. The September 3, 2026 Owner reconciliation below supersedes the former mandatory-decision reading of OD-001; OD-002 through OD-004 remain controlling within their bounded, Core-conforming semantics. This record does not establish validation or production readiness.

Supporting candidate provenance: `lattice-conversation-drift-design-approval-handoff-v1.zip`, SHA-256 `63933fa9e78e515b1b1c454c746dd3906a46884833571693d366682889218973`, remains supporting design evidence. Its synthetic simulations do not establish Product correctness. Where this record differs from or extends that candidate, this Owner-confirmed record controls Product design.

Protected boundaries remain unchanged: V36 Truth Core owns external factual truth; Lattice Decision Engine owns eligibility/ranking/outcome semantics; Lattice Intent Authority owns canonical user intent; Solandra Experience owns interaction/presentation/advocacy; Lattice Execution Runtime owns operational lifecycle; Lattice Model Gateway remains non-authoritative.

---

## OD-001 — Product definition and 1.0 capability boundary

**Status: RESOLVED / CONFIRMED**

Lattice 1.0 is **trustworthy knowledge plus conditional decision capability**.

Its guaranteed Product journey is:

```text
natural-language question or objective
-> authoritative intent
-> material clarification when necessary
-> bounded research
-> V36 verification
-> KnowledgeOutcome, Action Preparation, or qualified DecisionSupportOutcome
-> faithful Solandra Conversation + Composer presentation
-> conversational continuation
```

Guaranteed 1.0 capabilities include ordinary-language knowledge, decision, and Action Preparation needs; versioned Intent Authority; material clarification; bounded research where needed; V36 verification of material external-world facts; KnowledgeOutcome without candidate-shaped inputs; conditional generalized Decision Engine semantics; non-consequential Resource preparation; faithful Solandra explanation/continuation; durable Run execution/cancellation/recovery/progress; and the isolation/privacy/operations foundations required for a production-capable release.

Autonomous external actions/transactions remain outside guaranteed 1.0 unless separately promoted and authorized. Generalized provider ecosystems, broad autonomous agents, and unrelated modes are not implied by this capability definition.

**Invariant:** trustworthy knowledge is a complete Product outcome. `DecisionPlan`, decision evidence projection, Decision Engine, and `StructuredDecision` exist only when decision work is actually qualified; they are not universal Run state.

---

## OD-002 — Durable V36 continuation protocol

**Status: RESOLVED / CONFIRMED**

V36 may yield for durable research without transferring epistemic authority to Lattice Execution Runtime.

```text
V36
  -> NEEDS_RESEARCH { checkpoint, researchRequests[] }

Lattice Execution Runtime
  -> durably schedules/executes requests
  -> persists immutable execution results

V36.resume(checkpoint, results)
  -> authoritative epistemic continuation
  -> may yield NEEDS_RESEARCH again
  -> or produce the next authoritative truth state
```

Every yield produces a complete immutable checkpoint sufficient to resume protected epistemic computation without reconstructing truth semantics from mutable runtime state.

V36 owns whether research is epistemically required, research purpose/evidence requirements, admission/rejection, sufficiency, contradiction/corroboration, further-round need, and authoritative truth state. Execution Runtime owns durable scheduling, dispatch, leases/retries/timeouts/cancellation, provider execution, operational budgets/exhaustion reporting, and immutable execution-result persistence.

Execution Runtime cannot force epistemic completion, treat provider success as truth sufficiency, or convert operational inability into an epistemic verdict.

**Invariant:** Operational inability is not epistemic judgment.

---

## OD-003 — Lattice Decision Engine criterion and outcome model

**Status: RESOLVED / CONFIRMED**

Lattice uses one authoritative Decision Engine with a versioned qualified **Criterion Catalog** of typed `CriterionDefinition` records. Specialist Guidance may identify/explain/challenge criteria but does not own authoritative criterion computation.

Authoritative user priority tiers are:

1. `MUST_HAVE`
2. `MATTERS_MOST`
3. `IMPORTANT`
4. `NICE_TO_HAVE`

Hard requirements are tri-state: `SATISFIED | FAILED | UNKNOWN`. `UNKNOWN` is not zero utility and cannot be treated as satisfied for eligibility.

Higher priority tiers dominate lower tiers only when the higher-tier difference is meaningful under qualified tolerance semantics. If within the applicable equality/tolerance band, evaluation proceeds to lower tiers. User-specific tolerance belongs to Intent Authority; criterion/domain meaningful-difference semantics belong to CriterionDefinition; evidence ability/uncertainty belongs to V36.

Criteria have equal influence within a tier by default unless authoritative USER intent establishes another representable relationship. Unknown preference utility is not converted to zero; coverage remains separate and follows qualified missing-evidence policy.

Material unresolved information routes by authority: research/evidence gaps to V36, preference/intent gaps to Intent Authority clarification, and boundedly irresolvable gaps to explicit limitation. Lattice does not force a #1 option.

The authoritative recommendation set is the **material-dominance frontier**: strongest credible options not materially dominated under confirmed intent, admitted evidence, qualified criteria/tolerances, and uncertainty. Each frontier option carries structured authoritative reasons/trade-offs. Solandra may adapt presentation but cannot erase a materially distinct path from the authoritative frontier.

If Intent Authority establishes explicit USER final-choice delegation, Decision Engine may produce an authoritative `DelegatedSelection` from the valid frontier. The frontier remains intact; the selection is Lattice judgment under USER-delegated authority, not a user preference. Solandra presents it but does not own it.

```text
IntentVersion
  -> requirements / priority tiers / user tolerances / delegation
V36 Truth Core
  -> admitted decision evidence
Criterion Catalog
  -> qualified criterion semantics
Lattice Decision Engine
  -> eligibility / material-dominance frontier / delegated selection when authorized
  -> structured authoritative reasons
Solandra Experience
  -> faithful adaptive presentation
User
```

---

## OD-004 — Lattice Intent Authority semantics

**Status: RESOLVED / CONFIRMED DESIGN**

### Core authority

Solandra may interpret, advocate, challenge, summarize, and propose semantic changes. Intent Authority validates USER provenance, materiality, freshness, representability, and transition semantics before committing canonical intent.

```text
USER message
  -> Solandra/interpreter proposal
  -> ProposedIntentDelta
  -> Product-owned Intent Authority validator/reducer
  -> immutable IntentVersion only on authoritative semantic change
```

Persisted messages are context/provenance; canonical intent is immutable structured versioned state within an `IntentScope`. Transcript proximity, assistant/model text, model confidence, summaries, specialist output, retrieved content, or system output cannot independently become USER authority.

Only persisted USER-origin meaning may authorize canonical intent mutation, directly or through exact proposal-bound USER confirmation.

### Provenance, pending meaning, and clarification

Interpretation distinguishes at least `EXPLICIT_USER`, `USER_REFERENCE`, `INFERRED_NON_MATERIAL`, `INFERRED_MATERIAL`, and `UNRESOLVED`; accepted exact confirmation may carry `USER_CONFIRMED` provenance.

Unconfirmed material meaning remains in a separate pending transition/clarification envelope. The prior confirmed IntentVersion remains controlling downstream. Pending transition != IntentVersion.

Confirmation binds only the exact semantic proposal presented while fresh for its exact scope/base version/message horizon. Ambiguous multi-proposition confirmation fails closed.

Clarifications bind exact scope, base `intentVersionId`, message/sequence horizon, and pending proposition. Later USER messages may resolve/supersede/reformulate/obsolete them; stale clarifications are not asked mechanically.

Intent need only be materially sufficient, not exhaustively complete. Relevant states distinguish `CONFIRMED`, `UNRESOLVED_NON_MATERIAL`, and `UNRESOLVED_MATERIAL`. Material ambiguity that could change eligibility, planning, research requirements, or authoritative outcome fails closed unless resolved or validly delegated.

### Delta, semantic version, provenance, correction

Canonical semantic operations are `SET`, `REMOVE`, and `NO_CHANGE`; omission never means removal.

Only genuine canonical semantic change advances IntentVersion. Reaffirmation, normalization, replay, rejected/stale proposals, and semantic no-ops preserve provenance without version churn.

Provenance binds at operation/field level. USER support for one field cannot authorize unrelated mutation.

Clear later USER correction creates an immutable successor with correction/supersession lineage. Historical Runs remain exactly bound to their earlier IntentVersion. Ambiguity between correction/addition/condition/alternative is clarified rather than blindly overwritten.

“Undo that” creates a new immutable revert successor targeting a specific prior semantic change; it never erases the action/version being undone. Ambiguous target clarifies.

“Start over” within a scope creates an immutable `RESET_SUPERSEDES` successor clearing current scope semantics while retaining history. Reset is not privacy deletion.

### Active Run correction and exact binding

Non-material correction may allow an existing Run to complete on its historical bound intent; material correction supersedes the decision attempt and creates a successor Run bound to the new exact intent. Evidence/V36 conclusions/Product validation do not transfer automatically.

Every Run binds exact `intentScopeId + intentVersionId`. When decision work is qualified, its DecisionPlan binds and faithfully projects that same exact IntentVersion. Later correction never moves a historical Run or DecisionPlan binding.

### Idempotency, concurrency, transition envelope

Messages are append-only logical history; message sequence != semantic version.

Every USER turn has stable logical identity. One logical USER turn may produce at most one authoritative semantic effect per intent scope; retries reproduce prior transition disposition.

Transitions use optimistic CAS bound to exact scope, base IntentVersion, observed message horizon, logical USER turn, and source digest. Stale proposals are rejected/re-evaluated, never blindly merged because they remain plausible. Actual commits serialize per scope.

The transition envelope is immutable/server-owned and binds transition identity, scope, base version, observed horizon, logical USER turn, source message/digest, proposed operations, provenance/materiality, and disposition.

The reducer follows a fail-closed order equivalent to: origin binding -> idempotency -> freshness/CAS -> operation/provenance validation -> materiality -> representability/conditionality/separability -> apply candidate delta -> semantic equality -> append version only on change -> persist disposition/audit.

### Partial commitment, representability, conditional meaning

A USER message may partially commit independently supported semantic operations while materially unresolved operations remain pending only when committed meaning is semantically independent. Coupled or conditional meaning remains atomic.

Explicit USER meaning that cannot be faithfully represented by the qualified schema is not coerced to a nearest value. It remains unresolved and blocks dependent work when material.

Conditional intent is represented explicitly with trigger/condition, effect, provenance, and activation. Solandra cannot collapse it prematurely. Trigger authority remains with the owning system: external factual trigger -> V36; decision-state trigger -> Decision Engine; USER meaning of condition/effect -> Intent Authority.

### Absence and delegation states

Intent Authority distinguishes at least `UNSPECIFIED`, `NO_PREFERENCE`, `OPEN`, `UNRESOLVED`, and `DELEGATED`. Silence is not automatically indifference, flexibility, ambiguity, or delegation.

Delegating judgment is itself authoritative USER intent. Ordinary “use your judgment” grants bounded discretion over explicitly delegated/open dimensions while preserving existing goals, requirements, preferences, tolerances, and corrections. Judgment exercised under delegation is not retroactively converted into user preference.

Delegation is explicit, scoped, revocable, provenance-bound, and does not silently transfer across scopes. Newly discovered criteria enter a persistent delegation only if clearly inside the USER-delegated semantic scope; discovering a criterion never expands delegation. Materially ambiguous inclusion clarifies.

Ordinary bounded delegation does not grant final-choice authority. Stronger USER meaning such as “pick one for me” authorizes final choice. Intent Authority records permission; Decision Engine produces any authoritative DelegatedSelection from the valid frontier.

By default final-choice delegation is bounded to the current materially sufficient decision state. Material intent/frontier change makes the prior selection historical and requires renewed authority. The USER may explicitly grant persistent bounded final-choice delegation for the same scope; it remains separately represented, scoped, revocable, and subordinate to later correction.

Final-choice delegation never authorizes external purchase/action/transaction authority.

### Solandra advocacy and Specialist Guidance

Specialists advise Solandra; expertise affects inquiry/proposals, not Intent Authority.

Solandra is the USER's advocate before, around, and after authoritative systems. It may represent USER interests, develop/challenge option cases, seek needed expertise/evidence, and surface decision-discriminating questions.

> Solandra may argue for investigation, clarification, consideration, challenge, and explanation. It may not argue facts into truth, assumptions into user intent, or favored options into the recommendation frontier.

Different specialist “hats” change the inquiry lens, not authority.

### Historical references, multiple scopes, reuse, composites

Intent Authority may retrieve selective historical USER provenance and exact intent lineage for references such as “same budget as before.” Transcript proximity is not authority; material ambiguity clarifies.

One conversation may contain multiple explicit intent scopes, each with stable scope identity, independent immutable IntentVersion lineage, pending transitions/clarifications, and exact Run bindings. Active conversational scope is routing state, not semantic authority.

An unambiguous new decision objective may create a new scope without ritual confirmation. If materially ambiguous whether USER means current-decision change, alternative, or new decision, clarify.

Cross-scope reuse is explicit USER-authorized copy by value with provenance, not shared mutable authority. Later source change does not silently update target.

When USER wants separate decisions evaluated jointly under shared constraints/trade-offs, create a new composite intent scope bound to exact source scope/version snapshots. Original scopes remain intact; composite has its own lineage; later source changes do not silently rewrite it.

If USER explicitly requests synchronization, the synchronization rule is itself versioned, scoped, revocable intent. Propagated changes retain provenance to the synchronization grant and causal USER change.

“I’m done with that” may close/inactivate a scope without deleting history; clear return to the same decision resumes its lineage. Closure is not privacy deletion.

A USER message clearly targeting several scopes may create independent transitions in those scopes from the same USER provenance. Vague/global language never becomes automatic cross-scope preference.

### Persistence expectations

Append-only logical messages and immutable intent history must enforce unique ordered version lineage per scope, unique transition identity, at-most-one authoritative effect per logical USER turn per scope, and exact source/freshness binding for clarification/transition disposition. Concrete table/index names remain implementation choices if these semantics are preserved.

---

## Cross-decision authority invariants

- Solandra proposal != Intent Authority commit.
- inferred meaning != explicit USER intent.
- specialist observation != USER priority.
- model confidence != authority/materiality.
- USER silence != indifference/flexibility/ambiguity/delegation.
- omitted field != `REMOVE`.
- pending transition != IntentVersion.
- transcript proximity != authority.
- stale clarification != still-needed clarification.
- confirmation binds only the exact semantic proposal confirmed.
- reset/revert != deletion/history rewrite.
- cross-scope reuse != shared mutable authority.
- composite decision != merger of source histories.
- conditional meaning != unconditional meaning.
- separable partial commit != tearing apart coupled meaning.
- delegation permission belongs to Intent Authority; delegated authoritative selection belongs to Decision Engine.
- Run supersession != evidence/validation transfer.
- message order != semantic version.
- stale proposal is not mergeable merely because plausible.
- model/provider/simulator output remains non-authoritative until accepted by the owning Product authority under its contract.

## Remaining open decisions explicitly not resolved here

This record does not resolve OD-005 through OD-010. In particular, OD-006 generalized Solandra explanation licensing/fidelity and OD-007 cross-conversation memory remain open; directional discussion does not silently resolve them.

## Implementation and validation boundary

This record authorizes Product design semantics for OD-001 through OD-004. It does not claim repository implementation or validation.

Before normative implementation: bind a Product Work Item to the exact current revision and this record; inspect source/persistence contracts; implement the smallest coherent slice; add targeted regression/Product-observable probes; validate the exact implementation revision; and keep test success, Product acceptance, and production readiness distinct.
