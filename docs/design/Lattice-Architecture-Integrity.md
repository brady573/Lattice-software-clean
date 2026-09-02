# Lattice Architecture Integrity

Status: **Owner-approved cross-cutting Product architecture control**.

Approved: **August 26, 2026**.

Current deployment reconciliation baseline: `main @ 51d47bb27bf1f42051917654e308ef458d3cd5fc`, tree `6b7e6a34d96c7c09668e46495394215f69a53751`.

Source candidate artifact: `lattice-antidrift-handoff-v1.zip`, SHA-256 `d4f015a01106cc22fcdd7e348c4694ca970712b38421025ff839beec2d90101c`.

## 1. Purpose

Lattice Architecture Integrity preserves **Product-semantic ownership and authority boundaries** as Lattice evolves across M3-M12.

It is cross-cutting Product architecture, not a Product subsystem and not a numbered milestone. It supplements the canonical living Product design without renumbering M0-M12.

The current implementation-level composition of these protected boundaries is mapped in `docs/design/Lattice-System-Architecture.md`. That structural map may name durable bindings and implementation components such as `DecisionPlan`, Run stores, workers, bridges, and presentation projections without creating additional peer semantic authorities.

This document intentionally does **not** duplicate repository/process operating guidance. Applicable Owner/Project guidance governs requirement qualification, debugging/recovery process, source freshness, validation provenance, Owner-only boundaries, production/security/cost controls, and optional workflow mechanics. Those operating mechanics do not create Product requirements or require a particular team, issue tracker, review ceremony, or handoff structure.

## 2. Product-semantic invariants

### AIC-01 — Canonical ownership does not transfer implicitly

Use the canonical Product systems when authority distinctions matter:

- **Lattice Intent Authority** owns canonical versioned USER intent and correction lineage.
- **Lattice Execution Runtime** owns durable operational lifecycle, coordination, cancellation, recovery, and research execution.
- **Lattice Model Gateway** is a non-authoritative model capability boundary.
- **V36 Truth Core** owns protected external factual truth/evidence state.
- **Lattice Decision Engine** owns authoritative eligibility, ranking, frontier, and StructuredDecision semantics.
- **Solandra Experience** owns human-facing conversation, advocacy, presentation, and explanation within its licensed fidelity boundary.
- **V7 LLM Simulation Lab** is an external development simulation/qualification system, not Product authority.

`DecisionPlan` is the durable exact IntentVersion-to-Run planning binding used by the current implementation. It does not independently own USER meaning, execution lifecycle, truth, decision, or presentation semantics.

A rename, adapter, process split, model output, provider, simulator, UI surface, repository move, persistence boundary, durable binding, or deployment transition does not transfer authority between these systems.

### AIC-02 — Operational capability cannot become truth authority

Execution Runtime state, Model Gateway output, provider output, simulator output, retrieval mechanics, retries, availability, or operational failure must not create or strengthen V36 truth.

Only the protected V36 contract may admit or change authoritative factual evidence state.

### AIC-03 — Intent, truth, decision, and presentation remain separate

Transcript/model interpretation may propose USER meaning but must not silently become canonical Lattice Intent Authority state.

V36 truth does not select a winner by itself. Lattice Decision Engine logic must not strengthen evidence to improve a candidate. Solandra may advocate, challenge, clarify, and explain, but generated prose must not create USER intent, external facts, eligibility, recommendation frontier membership, or winner identity.

### AIC-04 — Prototype and provider evidence does not silently promote Product authority

Development prototypes, Specialist Guidance, simulated conversations, local models, hosted simulators, and future live providers remain within their explicitly qualified Product boundary.

Prototype success does not silently authorize canonical Intent Authority integration, V36 evidence admission, Decision Engine authority, production operation, or live-provider promotion.

### AIC-05 — Milestone transitions preserve upstream semantics

Later milestones may add capability but must preserve confirmed upstream authority contracts unless a qualified Product design explicitly changes them.

Examples:

- M4 durable research may extend execution while V36 remains epistemic authority.
- M5 Intent Authority may structure USER intent without giving Solandra/model inference canonical commit authority; durable DecisionPlan binding preserves exact IntentVersion-to-Run planning fidelity without becoming a new semantic authority.
- M6 Decision Engine generalization may expand decision semantics without changing V36 evidence strength.
- M7-M8 conversation/auth continuity may add persistence without changing truth/decision ownership.
- M9 live-provider work may add provider capability without changing provider non-authority.
- M10 Solandra generalization may improve explanation without changing authoritative decision state.

## 3. Milestone integration

Architecture Integrity applies continuously across **M3-M12** and does not consume a milestone number.

| Milestone range | Product-semantic integrity requirement |
|---|---|
| M3-M4 | Preserve Execution Runtime operational ownership versus V36 epistemic ownership during durable composition and research continuation. |
| M5 | Prevent transcript/model interpretation from silently becoming canonical Intent Authority; preserve explicit USER-provenance semantics and exact DecisionPlan/Run binding. |
| M6 | Preserve V36 truth versus Decision Engine decision authority; scoring/utility logic cannot strengthen evidence. |
| M7-M8 | Preserve conversation/progress/auth/data ownership boundaries while adding persistence and continuity. |
| M9 | Live-provider capability remains non-authoritative and requires separate Product qualification. |
| M10 | Solandra remains fidelity-bound over intent/truth/decision authority; generated explanation cannot create material Product facts. |
| M11 | Production operation does not change Product semantic ownership merely because deployment topology changes. |
| M12 | Apply AIC-R1 to the exact release candidate in addition to the applicable release gates. |

## 4. Supplemental release gate — AIC-R1

M12 requires the existing applicable G1-G10 release gates **plus AIC-R1 — Architecture Integrity**.

AIC-R1 PASS requires the exact release candidate to demonstrate, for the release scope:

1. canonical Product systems still own the semantics assigned to them by qualified Product design;
2. no adapter, model, provider, simulator, UI, process split, rename, persistence boundary, durable binding, or deployment transition has silently transferred authority;
3. no prototype-only or development-only mechanism has silently become canonical or production authority;
4. Intent Authority, V36 Truth Core, Decision Engine, and Solandra Experience remain semantically separated as specified;
5. milestone-added capability preserves confirmed upstream Product invariants unless an explicit qualified design change says otherwise;
6. all release-relevant Product architecture sources are mutually consistent on system ownership and authority boundaries.

AIC-R1 is a Product architecture gate. Applicable Owner/Project operating guidance remains controlling for how release validation, provenance, acceptance, production authorization, and any optional coordination mechanics are executed.

## 5. Deployment model and nonclaims

Architecture Integrity is repository-visible Product architecture, not a runtime service.

Its minimal repository surface is:

- this Product architecture document;
- the current structural map in `docs/design/Lattice-System-Architecture.md`;
- concise roadmap integration across M3-M12 and M12/AIC-R1; and
- one repository-adapter discoverability reference.

It introduces no runtime dependency, migration, provider, database resource, secret, paid service, production deployment, external infrastructure, team topology, issue tracker, reviewer quorum, or operational staffing requirement.

It does not independently validate Product behavior, transfer validation between revisions, qualify unrelated handoffs, or replace the living Product design, current system architecture map, system registry, V36 contract, applicable Owner/Project operating guidance, or explicit Owner authority.

## 6. Change control

Material changes to these Product-semantic integrity constraints require an explicit qualified Product design update. Repository-process guidance belongs in the repository adapter or applicable Project operating guidance rather than being duplicated here.
