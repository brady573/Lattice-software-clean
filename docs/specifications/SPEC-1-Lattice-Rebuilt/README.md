# SPEC-1 — Lattice Truth-Core Prototype Architecture

Status: **Owner-approved detailed Product implementation/prototype specification.**

Repository form of SPEC-1 for confirmed Lattice Product contracts. The canonical living Product design and forward 1.0 roadmap is `../../design/Lattice-Living-Software-Design-to-1.0.md`.

The living design controls architecture direction and forward milestone sequencing. Its item-level status vocabulary is controlling: **Confirmed** items govern; **Working assumption** items remain reversible; **Proposed** and **Open decision** items do not independently authorize Product mutation. SPEC-1 remains normative for detailed confirmed requirements and implementation contracts that the living design has not explicitly superseded.

The specification is split for repository readability; section numbering and order remain continuous:

1. `01-source-through-dispatch.md` — source basis, Product requirements, durable architecture, repository/dependency direction, Run lifecycle, transactional dispatch.
2. `02-tasks-through-planning.md` — task idempotency, budgets/deadlines/cancellation, data model, migrations, intelligence/tools, evidence, planning.
3. `03-decision-through-vertical-slice.md` — StructuredDecision semantics, explanation fidelity, memory, API/SSE, security, deployment, configuration, original vertical-slice architecture.
4. `04-testing-through-alignment.md` — testing, acceptance, **historical** build sequence/milestones, evaluation, launch bars, traceability, completion/alignment.
5. `05-truth-core-offline-prototype.md` — **current truth-core revision**: V36 as protected epistemic core, core-contamination rules, exact V36 truth semantics, offline-only prototype stage, offline acceptance baseline, and offline-to-live promotion contract.
6. `06-living-design-reconciliation.md` — **current Product-direction reconciliation**: maps legacy SPEC-1 decision/Solandra text, historical roadmap labels, launch bars, P-series capability lineage, and downstream authority to the canonical living design without changing V36 epistemic semantics.

## Normative precedence

The Project Owner approved the truth-core revision in Project conversation and directed it to be installed in the repository. The Owner subsequently designated the living design as the canonical source for Product design direction and 1.0 sequencing and authorized SPEC-1 reconciliation.

Apply these layers together:

1. Explicit current Owner decisions and the living design's **Confirmed** items control Product direction.
2. The living design controls the forward M0–M10 roadmap and sequencing. Older SPEC-1 build/milestone labels are historical capability/provenance references, not current roadmap identifiers.
3. SPEC-1 sections 1–33 remain normative for detailed confirmed Product requirements, durability, idempotency, recovery, security, API ownership, and other contracts unless explicitly superseded by an authoritative living-design item or section 51 reconciliation.
4. Sections 34–50 in `05-truth-core-offline-prototype.md` remain the controlling revision for protected prototype truth-core semantics. Where any earlier SPEC-1 section conflicts with sections 34–50, the later truth-core section controls.
5. Sections 51–52 in `06-living-design-reconciliation.md` control Product-direction reconciliation of legacy SPEC-1 text. They do not alter V36 claim types, proof obligations, provenance, admission, contradiction/corroboration, verdict, positive-burden, same-Run, truth-confidence, or truth-persistence semantics.
6. A living-design **Working assumption**, **Proposed** item, or **Open decision** does not silently supersede a confirmed SPEC-1 or V36 contract. Dependent Product mutation must remain reversible or wait for the required decision/qualification.

Sections 34–50 specifically supersede earlier conflicting text concerning:

- the architectural center of Lattice;
- truth/claim taxonomy;
- factual evidence admission;
- provenance and corroboration semantics;
- provider/model confidence;
- decision use of factual evidence;
- feature dependency direction around the truth core;
- the order and qualification boundary for live providers;
- the prototype offline/live-provider cut line;
- offline acceptance and promotion to live-provider testing.

The exact V36 machine-readable proof-obligation contract remains `../V36-Truth-Layer/claim-proof-contracts.json` for the current prototype truth core.

## Roadmap relationship

Forward Product planning uses `../../design/Lattice-Living-Software-Design-to-1.0.md` §23 and Appendix B, with the derived current execution view in `../../ROADMAP.md`.

- `04-testing-through-alignment.md` §§27–28 preserve the pre-V36/original prototype build sequence and M1–M14 labels as historical context only.
- `05-truth-core-offline-prototype.md` §§47–48 preserve the truth-core bootstrap/capability sequence and P1–P8 lineage. Those are protected-core capability gates, not a competing Product roadmap.
- `06-living-design-reconciliation.md` §§51–52 provide the controlling interpretation where those legacy sections or downstream ownership wording could otherwise conflict with the living design.
- Live-provider work remains separately qualified even when it appears in a roadmap or capability sequence.

## Architectural law

**The V36 Truth Engine is the protected epistemic core of Lattice.**

All material external-world factual assertions that can affect an authoritative Lattice decision must pass through V36 before downstream Product logic may treat them as established evidence.

The Decision Engine owns authoritative eligibility, ranking, and `StructuredDecision` semantics. Solandra is the Product-facing communication/presentation layer over persisted authoritative truth and decision state; it cannot alter either authority.

Outer capabilities are built around the core. Feature work must not silently weaken or bypass it.

The prototype begins offline. A complete offline baseline must be accepted before Lattice becomes Product-eligible for a separately qualified live-provider testing Work Item.
