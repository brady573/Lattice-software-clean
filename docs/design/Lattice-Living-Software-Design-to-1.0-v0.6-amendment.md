# Lattice Living Software Design to 1.0 — v0.6 Amendment

Status: **HISTORICAL OWNER-APPROVED AMENDMENT; OD-001 PORTION SUPERSEDED BY THE CORE RECONCILIATION**

Date: **2026-08-27**

Reconciliation baseline: `main @ 59ad7bab970171b696aa853ff1a56e242e13f7c7`

Amends: `docs/design/Lattice-Living-Software-Design-to-1.0.md` v0.5.

Detailed decision record: `docs/design/Lattice-Owner-Decisions-OD-001-to-OD-004.md`.

## Authority and precedence

This amendment is part of the canonical Lattice living Product design. It records explicit Owner decisions resolving OD-001 through OD-004.

`The-Core-Lattice-Philosophy.md` and the current Living Design are higher authority. OD-002 through OD-004 remain useful controlling detail where they conform to the Core. Amendment A's mandatory-decision Product definition is retained only as historical decision provenance and must not guide current implementation.

This is design authority only. It does not claim implementation, test validation, production readiness, or cross-revision validation.

The external `lattice-conversation-drift-design-approval-handoff-v1.zip` remains supporting candidate provenance. Its synthetic results are not Product validation. The Owner-confirmed OD-004 semantics in the detailed decision record are now the controlling Product design for Intent Authority.

---

## Amendment A — §0.3 / OD-001: historical definition, now superseded

This August 27 wording formerly superseded the v0.5 working assumption:

> **Lattice 1.0 is a Trusted Decision Product. Its guaranteed Product journey is natural-language goal -> authoritative intent -> material clarification when necessary -> bounded research -> V36 verification -> authoritative decision -> faithful Solandra explanation -> conversational continuation. General explanation, verification, research-report, planning, document-analysis, and autonomous-action products are outside guaranteed 1.0 unless separately promoted.**

Current interpretation is instead governed by the Core-aligned OD-001 reconciliation: Lattice 1.0 is trustworthy knowledge plus conditional decision capability. The quoted mandatory-decision wording above is not current Product authority.

Autonomous external actions/transactions remain outside guaranteed 1.0 and require separate Product/authority decisions.

---

## Amendment B — §3.3 and §8: OD-004 Intent Authority design is Confirmed

The v0.5 statements that the detailed Intent Authority transition/reducer/persistence/provenance contract is still Proposed/OD-004 are superseded.

OD-004 is now **RESOLVED / CONFIRMED DESIGN** through `docs/design/Lattice-Owner-Decisions-OD-001-to-OD-004.md`.

The external Intent Authority handoff remains supporting provenance, but it is no longer the authority barrier preventing implementation of the Owner-confirmed semantics.

### Controlling Intent Authority model

- transcript/messages are context and provenance, not canonical intent;
- canonical intent is immutable, structured, versioned state within stable `IntentScope` identity;
- only USER-origin meaning or exact USER confirmation can authorize canonical mutation;
- Solandra/interpreter/model output may propose semantic deltas but cannot commit intent;
- material unresolved meaning remains pending outside authoritative intent;
- clarification/confirmation is exact scope/base-version/message-horizon/proposal bound;
- semantic operations are `SET`, `REMOVE`, `NO_CHANGE`; omission never means removal;
- semantic equality gates IntentVersion advancement;
- operation/field-level provenance is retained;
- later correction/revert/reset creates immutable successor lineage and never rewrites history;
- active-Run material correction creates successor execution rather than moving historical Run binding;
- one logical USER turn is idempotent per intent scope;
- transitions use exact base-version/message-horizon/source binding and fail closed on staleness;
- separable independent USER operations may partially commit, while coupled/conditional meaning remains atomic;
- unrepresentable explicit USER meaning is not coerced;
- conditional intent remains explicit and trigger authority stays with the owning authority;
- `UNSPECIFIED`, `NO_PREFERENCE`, `OPEN`, `UNRESOLVED`, and `DELEGATED` are distinct;
- multiple intent scopes have independent lineages and no silent bleed;
- explicit cross-scope reuse copies by value with provenance, not live mutable reference;
- joint decisions create new composite scopes bound to exact source-scope/version snapshots;
- explicit synchronization is separately versioned/revocable USER intent;
- scope closure is non-destructive and distinct from privacy deletion;
- every downstream Run binds exact `intentScopeId + intentVersionId`; a DecisionPlan additionally binds that exact version only for qualified decision work.

### Delegation

Bounded discretion is explicit USER intent and never retroactively becomes user preference.

Ordinary “use your judgment” grants only bounded discretion within the USER-delegated semantic scope. Explicit final-choice language such as “pick one for me” is required for final selection authority.

Intent Authority owns the USER delegation grant. Decision Engine owns any authoritative delegated selection from the valid frontier. Solandra presents the result faithfully. Final-choice delegation does not authorize external transactions/actions.

Final-choice delegation is decision-state bounded by default; persistent bounded final-choice delegation requires explicit USER authorization.

### Solandra advocacy boundary

Solandra is the USER's advocate before, around, and after authoritative systems. It may develop/challenge option cases, seek expertise/evidence, and surface decision-discriminating questions.

> Solandra may argue for investigation, clarification, consideration, challenge, and explanation. It may not argue facts into truth, assumptions into user intent, or favored options into the recommendation frontier.

Specialist Guidance changes the inquiry lens, not Product authority.

---

## Amendment C — §9.3 / OD-002: durable V36 research handshake is Confirmed

The v0.5 open design detail for the durable V36 work-state handshake is superseded at the authority/behavior level.

The confirmed protocol is:

```text
V36
  -> NEEDS_RESEARCH { checkpoint, researchRequests[] }

Execution Runtime
  -> durable schedule / execute / persist immutable results

V36.resume(checkpoint, results)
  -> next V36 epistemic step
  -> NEEDS_RESEARCH again or authoritative truth state
```

Every yield uses a full immutable V36 checkpoint sufficient for authoritative continuation.

V36 owns epistemic need, evidence requirements, admission, sufficiency, contradiction/corroboration, further-round need, and truth verdict. Execution Runtime owns operational scheduling/execution/retries/timeouts/cancellation/budgets/result persistence.

> **Operational inability is not epistemic judgment.**

The exact checkpoint schema remains a protected Truth-Core implementation detail to be implemented/tested under the confirmed ownership contract; it is no longer an unresolved Product behavior decision.

---

## Amendment D — §11 / OD-003: Decision Engine model is Confirmed

The v0.5 proposed criterion/ranking model is superseded where it conflicts with this confirmed design.

Lattice has one authoritative Decision Engine and a versioned qualified **Criterion Catalog** of typed CriterionDefinitions.

Confirmed semantics:

- USER priority tiers: `MUST_HAVE`, `MATTERS_MOST`, `IMPORTANT`, `NICE_TO_HAVE`;
- hard requirements: `SATISFIED | FAILED | UNKNOWN`;
- unknown is not zero utility and cannot satisfy a hard requirement;
- bounded compensation: a higher tier dominates only when the difference is meaningful under qualified tolerance semantics; otherwise evaluation proceeds lower;
- USER-specific tolerance belongs to Intent Authority; criterion tolerance/utility semantics to CriterionDefinition; evidence ability/uncertainty to V36;
- equal influence within a tier by default absent authoritative USER intent to the contrary;
- preference coverage/unknown state is represented separately from utility;
- material research gaps route to V36, material preference gaps to Intent Authority, boundedly irresolvable gaps remain explicit limitations;
- Lattice need not force a #1 result;
- authoritative recommendation state is the **material-dominance frontier** with structured reasons for each materially distinct option;
- Solandra may adaptively present the frontier but cannot erase a materially distinct path;
- explicit USER final-choice delegation permits Decision Engine to create a `DelegatedSelection` from the valid frontier without converting that judgment into user preference.

---

## Amendment E — §12: Solandra Experience authority clarification

Solandra Experience remains presentation/interaction/advocacy, not intent/truth/criterion/decision authority.

The following Owner-confirmed advocacy principle is added:

> **Solandra does not decide for the user. Solandra makes sure the user's decision gets the advocacy it deserves.**

Solandra presentation may be generative; Product authority remains deterministic/owned by the relevant authoritative system. The client remains a renderer and cannot derive authoritative eligibility, truth admission, winner/frontier, or contradiction materiality from presentation-only data.

This amendment does not resolve OD-006 generalized explanation licensing/fidelity.

---

## Amendment F — §23 milestones

The milestone objectives remain, but status/dependencies change as follows:

### M4 — Durable V36 Truth Core research handshake

**Design dependency OD-002: RESOLVED.** Implementation remains incomplete. M4 may proceed under the confirmed full-checkpoint `NEEDS_RESEARCH` / `V36.resume(...)` authority contract.

### M5 — Lattice Intent Authority + clarification + planning

**Design dependency OD-004: RESOLVED.** Implementation remains not started/incomplete. M5 implementation must bind to the confirmed OD-004 decision record and exact current repository state.

### M6 — Lattice Decision Engine generalization

**Design dependency OD-003: RESOLVED.** Implementation remains not started/incomplete. M6 must implement the confirmed Criterion Catalog, priority-tier, tri-state requirement, bounded-compensation, uncertainty/coverage, material-dominance-frontier, and delegated-selection semantics.

OD-001 is resolved and now controls 1.0 scope locks.

No implementation milestone is marked complete by these design decisions.

---

## Amendment G — §24 risk reconciliation

Historical note: this amendment formerly required explicit Owner change control for the Trusted Decision Product guarantee. The September 3, 2026 Owner reconciliation supplied that change; current scope is governed by the Core-aligned trustworthy-knowledge plus conditional-decision definition.

Replace “Resolve OD-004” as the Intent Authority mitigation with: implement the confirmed Product-owned transition/reducer/provenance contract and validate material-ambiguity fail-closed behavior on the exact implementation revision.

The V36 handshake contamination risk remains high, but its authority design is now fixed by OD-002; risk shifts from design ambiguity to implementation fidelity.

The generic Decision Engine risk remains, but its semantic direction is now fixed by OD-003; risk shifts to CriterionDefinition quality, domain qualification, and implementation/acceptance fidelity.

---

## Amendment H — §25 decision register

### Resolved decisions

| ID | Status | Controlling decision |
|---|---|---|
| OD-001 | **HISTORICAL WORDING / SUPERSEDED** | The former mandatory Trusted Decision Product journey is superseded by trustworthy knowledge plus conditional decision capability under the Core reconciliation. |
| OD-002 | **RESOLVED / CONFIRMED** | Full immutable V36 checkpoint at every `NEEDS_RESEARCH` yield; Execution Runtime executes/persists only; V36 owns epistemic continuation. |
| OD-003 | **RESOLVED / CONFIRMED** | One Decision Engine + qualified Criterion Catalog; four priority tiers; tri-state hard requirements; bounded compensation; material-dominance frontier; explicit delegated selection when authorized. |
| OD-004 | **RESOLVED / CONFIRMED** | Product-owned immutable/versioned Intent Authority with USER provenance, fail-closed clarification, semantic delta/reducer, exact scope/version binding, corrections/scopes/delegation/composites as detailed in the Owner decision record. |

### Remaining open decisions

The open-decision register now begins with OD-005. OD-005 through OD-010 retain their v0.5 meanings/status unless separately resolved.

In particular, OD-006 generalized Solandra explanation licensing/fidelity and OD-007 cross-conversation memory scope/user controls remain open.

---

## Amendment I — Appendix A source basis

Add:

- `docs/design/Lattice-Owner-Decisions-OD-001-to-OD-004.md` — Owner-confirmed Product design authority resolving OD-001 through OD-004.
- this v0.6 amendment — canonical reconciliation of those decisions into the living-design structure.

Reclassify the external Intent Authority handoff as **supporting candidate provenance for the now-confirmed OD-004 design**, not the controlling architecture and not Product validation.

---

## Amendment J — Appendix B near-term sequence

Replace the OD-dependent steps with:

5. Implement/validate the confirmed OD-002 durable V36 continuation handshake using full immutable checkpoints, preserving V36 epistemic authority.
6. Implement the confirmed OD-004 Intent Authority transition/persistence/provenance/scope/delegation contract; use the external handoff as supporting provenance, not independent authority or validation.
7. Implement the confirmed OD-003 Criterion Catalog and generalized Decision Engine semantics before generalized domains are enabled.

All other sequencing remains unchanged unless a later qualified design revision changes it.

---

## v0.6 change log entry

| Version | Date | Repository reconciliation baseline | Change |
|---|---|---|---|
| 0.6 | 2026-08-27 | 59ad7bab970171b696aa853ff1a56e242e13f7c7 | Historical amendment that confirmed the then-current Trusted Decision Product scope (later superseded), V36 full-checkpoint continuation, Decision Engine semantics, and detailed Intent Authority semantics. |

---

## Anti-drift audit

This amendment intentionally does **not**:

- alter protected V36 proof/admission semantics beyond the confirmed durable continuation boundary;
- transfer truth authority to Execution Runtime;
- transfer criterion/frontier authority to Solandra or specialists;
- transfer intent authority to Solandra/model output;
- resolve OD-006 or OD-007;
- authorize autonomous external actions;
- claim OD-001–004 implementation or validation;
- transfer prior test/CI evidence to future implementation revisions.
