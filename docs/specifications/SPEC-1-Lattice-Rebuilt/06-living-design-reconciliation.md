# 51. Canonical Living-Design Reconciliation

Status: **Owner-approved Product specification reconciliation.**

This section reconciles SPEC-1 with the canonical living Product design at `../../design/Lattice-Living-Software-Design-to-1.0.md` without weakening or replacing the protected V36 epistemic contract.

Repository installation provenance: on 2026-08-26, the Owner authorized the living design as the canonical source for Product design direction and 1.0 sequencing; this reconciliation records that installation without promoting Working assumption, Proposed, or Open decision items to confirmed implementation authority.

The living design is the canonical source for forward Product architecture direction and the M0–M10 roadmap. Its item-level status remains controlling: **Confirmed** items govern; **Working assumption** items may guide only reversible work; **Proposed** and **Open decision** items do not authorize Product mutation until separately accepted.

SPEC-1 remains the detailed implementation/prototype specification for confirmed contracts that have not been explicitly superseded. Sections 34–50 remain authoritative for V36 truth semantics except where this reconciliation explicitly corrects a downstream Product-ownership statement without changing V36 epistemic behavior.

## 51.1 Sections 17–18 — decision and Solandra

Section 17 records the original prototype decision model and remains useful as historical implementation provenance. Its hard-constraint supremacy, persistence-before-explanation, and separation of evidence coverage from decision reasoning remain compatible with the protected architecture.

The following forward-looking details in section 17 are **not** the controlling 1.0 decision design:

- the original raw/default score formula and numerical penalty constants;
- the original confidence thresholds;
- any implication that all future criteria share one raw numeric scale;
- the original outcome vocabulary where it conflicts with a later accepted decision-model contract.

The canonical living design §11 identifies typed criteria, criterion-specific utility, tri-state hard-constraint state, explicit tie/outcome semantics, and StructuredDecision evolution as **Proposed / Open Decision OD-003**. Those items are the forward design direction but do not authorize decision-semantic mutation until OD-003 is separately accepted or another qualified requirement supplies authority.

Until then, current confirmed repository decision semantics remain controlling for implementation, and all factual eligibility continues to be truth-gated by V36.

Section 18's core fidelity requirement remains confirmed: explanation is downstream of persisted authoritative state and cannot change winner, constraint status, truth state, or evidence state.

The richer ExplanationContext / ExplanationPlan / model-render / deterministic-fallback architecture in living design §12 is forward direction under **Open Decision OD-006**. It does not authorize a new Solandra fidelity contract until separately accepted.

## 51.2 Sections 27–28 — historical build sequence and milestones

Sections 27–28 preserve the original pre-V36/prototype build sequence and M1–M14 labels as historical design provenance only.

They are superseded for **forward sequencing and milestone identifiers** by the canonical living design §23 M0–M10 plan and the derived execution view at `../../ROADMAP.md`.

Historical milestone completion must not be mechanically mapped to a current M0–M10 milestone. Existing repository changes and exact-revision validation are evidence about implemented capabilities; each current milestone still requires its own stated exit criteria.

In particular, existing durable truth state, durable task/orchestration primitives, and asynchronous API control are reusable evidence and implementation foundations for current M1/M2, but they do not by themselves prove current M1 Durable Runtime Composition or M2 Durable V36 Research Handshake complete.

## 51.3 Section 29 — evaluation framework

Section 29 remains useful as a general evaluation taxonomy and as historical rationale for comparing Lattice with simpler model baselines.

Any numerical release threshold or provider-cost target must be traced to a currently accepted requirement before it is treated as a release gate. The living design makes concrete production SLOs, concurrency, provider budget, and availability targets **Open Decision OD-009**.

Evaluation remains subordinate to exact-revision Product acceptance: a favorable aggregate score cannot override a failing mandatory truth, durability, security, decision, or explanation criterion.

## 51.4 Section 30 — launch bars

The numerical launch bars in section 30 are retained as historical proposed targets, not current binding 1.0 release thresholds, unless separately reaccepted.

This includes the historical `>= 99%` terminal-Run target and `>= 60%` blind pairwise Lattice-win target. They must not be silently promoted into current SLO or Product-acceptance authority while OD-009 and the 1.0 Product threshold decisions remain open.

Structural safety requirements supported elsewhere remain controlling independently of those historical numbers, including:

- no candidate violating an established hard constraint may win;
- no cross-user authorization violation is acceptable;
- provenance/same-Run integrity must satisfy the active qualified contracts;
- duplicate/stale execution must not create duplicate accepted logical Product state;
- V36 acceptance failures cannot be averaged away by aggregate quality metrics.

## 51.5 Sections 47–48 — truth-core capability lineage

Section 47's prototype build sequence and section 48's P1–P8 truth-core milestones remain protected-core capability lineage and acceptance structure. They are **not** a second forward Product roadmap competing with living design M0–M10.

Use them to answer whether the relevant truth-centered capability and acceptance evidence exist. Use living design §23 to determine current Product sequencing.

The relationship is intentionally many-to-many: a current Product milestone may depend on several P-series capabilities, and a P-series capability may already be implemented before the current Product milestone that composes it into the 1.0 runtime.

Live-provider work remains separately qualified. Neither a P7/P8 label nor a living-design M7 label independently authorizes paid providers, production deployment, secrets, billing, or other Owner-only actions.

## 51.6 Section 50 — downstream authority clarification

Section 50's statement that “Solandra is the authoritative decision and communication layer” is superseded **only as to downstream decision ownership**.

The controlling Product ownership is:

- **V36** owns authoritative external-world truth semantics and admissible factual state.
- **Decision Engine** owns authoritative eligibility, scoring/ranking under the accepted decision contract, and `StructuredDecision`.
- **Solandra** owns Product-facing communication/presentation from persisted authoritative intent/truth/decision state and may not change those authorities.

This clarification does **not** change any V36 claim type, proof obligation, provenance rule, evidence-admission rule, contradiction/corroboration rule, material verdict, positive burden, same-Run rule, truth confidence semantic, or authoritative truth-persistence invariant.

The remainder of section 50 continues to control: build outward from V36; route material factual authority through V36; change V36 deliberately; never weaken the truth core merely to make another feature work.

# 52. Reconciled Forward Planning Rule

For future Product work, apply this sequence:

1. Read the canonical living design and identify the relevant item's status.
2. Resolve any required Open Decision or requirement authority before irreversible/non-reversible semantic mutation.
3. Read the applicable detailed SPEC-1 and V36 contracts.
4. Inspect the exact current repository state.
5. Bind the Work Item to current living-design milestone/exit criteria plus the detailed confirmed contracts it must preserve.
6. Treat old SPEC-1 milestone labels and P-series labels as capability/provenance references, not substitutes for current milestone acceptance.
7. Validate the exact candidate revision and report acceptance separately from transition/merge success.

This reconciliation changes documentation authority and forward sequencing only. It does not itself implement any Proposed 1.0 feature, activate a live provider, authorize production activity, or modify Product runtime behavior.
