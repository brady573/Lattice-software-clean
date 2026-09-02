# Lattice System Registry and Naming

Status: **Owner-approved Product naming and architecture-boundary convention**.

Approved: **August 26, 2026**.

Repository provenance for this installation Work Item: `main @ cad448809a8f02df6d31de4e516cd1df21d5b456`.

This registry gives every major Lattice Product or prototype system one canonical name so design documents, implementation handoffs, tests, and status reports do not accidentally merge distinct authority boundaries. It supplements the canonical living Product design; it does not weaken qualified SPEC-1 or protected V36 contracts.

The current implementation-level composition of these systems is mapped in `docs/design/Lattice-System-Architecture.md`. That document may describe implementation bindings such as `DecisionPlan`, Run stores, workers, persistence adapters, and presentation projections without promoting those components into peer Product authorities.

## 1. Canonical system registry

| Class | Canonical name | Short form | Owns | Does not own |
|---|---|---|---|---|
| Umbrella Product | **Lattice Product** | **Lattice** | The complete user-facing Product and Product-owned architecture. | It is not shorthand for one subsystem when a subsystem-specific claim is being made. |
| Product authority | **Lattice Intent Authority** | **Intent Authority** | Versioned structured user intent, intent deltas, clarification state, USER provenance, correction lineage, and exact `intentVersionId` binding. | External-world truth, eligibility/ranking, or presentation authority. |
| Product runtime | **Lattice Execution Runtime** | **Execution Runtime** | Durable Run lifecycle, coordination, cancellation, recovery, public Run events, research scheduling/work execution, and operational state. | External factual truth or decision semantics. |
| Product boundary | **Lattice Model Gateway** | **Model Gateway** | Provider-neutral model requests, capability negotiation, bounded/cancellable invocation, and model-adapter isolation. | User-intent authority, V36 truth, decision authority, or Product validation. |
| Product authority | **V36 Truth Core** | **V36** | External factual truth, evidence qualification/admission, provenance, contradiction, proof status, temporal applicability, and Lattice truth confidence. | User preferences, operational scheduling, or winner selection. |
| Product authority | **Lattice Decision Engine** | **Decision Engine** | Hard-constraint evaluation, eligibility, preference utility/ranking, trade-offs, tie/outcome semantics, and authoritative `StructuredDecision`. | Strengthening V36 truth or rewriting user intent. |
| Product experience | **Solandra Experience** | **Solandra** | Conversation UX, clarification presentation, progress presentation, explanation, adaptive Composer presentation, evidence/uncertainty presentation, Resource presentation, and continuation. | Canonical intent mutation, external truth, eligibility/ranking, or winner authority. |
| External development system | **V7 LLM Simulation Lab** | **V7 Simulation Lab** | Offline model/API simulation, protocol/fault experiments, and qualification evidence about the simulator itself. | Lattice Product authority, V36 acceptance, real-model reliability, or production readiness. |

`DecisionPlan` is an implementation-level durable binding, not a separate Product authority. It freezes the faithful planning projection of one exact `IntentVersion` for one Run. Likewise, research schedulers, research workers, provider adapters, API processes, persistence adapters, migration/admin processes, conversation indexes, and presentation projections are implementation components or process roles. They do not receive independent Product-authority names merely because they are durable or separately executable.

## 2. Canonical authority flow

The canonical conceptual flow is:

```text
User conversation
      |
      v
Lattice Intent Authority
      | confirmed IntentVersion
      v
DecisionPlan
      | exact planning projection for one Run
      v
Lattice Execution Runtime
      | research / operational work
      v
V36 Truth Core
      | admitted decision evidence
      v
Lattice Decision Engine
      | StructuredDecision
      v
Solandra Experience
      |
      v
User
```

`DecisionPlan` appears in the flow because it is the durable boundary that preserves exact intent-to-Run planning fidelity. Its placement does not make it a peer semantic authority: Lattice Intent Authority remains the owner of USER meaning, and Lattice Execution Runtime remains the owner of Run lifecycle.

The **Lattice Model Gateway** is a non-authoritative capability boundary that may be invoked by Product systems where a qualified design permits model assistance. Model output remains proposal/rendering material until the owning Product authority accepts it under its own contract.

During prototype development, the **V7 LLM Simulation Lab** may stand in for model/API behavior at the Model Gateway boundary. That substitution does not move the lab into Lattice Product authority.

## 3. Lattice Intent Authority naming decision

The Owner-approved canonical name for the user-intent subsystem is **Lattice Intent Authority**.

The uploaded external artifact `lattice-conversation-drift-design-approval-handoff-v1.zip` is therefore described as the **Intent Authority design handoff candidate**. Its central principle is:

> Transcript is context and provenance. Versioned structured intent is authority.

The naming and ownership boundary are confirmed by Owner decision. The artifact's detailed candidate architecture remains a design candidate until separately approved or incorporated into another qualified Product source. Recording the artifact in the living design does not by itself validate or implement its proposed reducer, persistence, provenance, clarification, or interpreter contracts.

## 4. Naming grammar

Use these suffixes consistently:

| Suffix | Meaning |
|---|---|
| **Core** | Protected semantic authority with especially strong invariants. |
| **Authority** | Canonical Product state within a bounded semantic domain. |
| **Engine** | Deterministic Product evaluation/transformation producing authoritative Product output. |
| **Runtime** | Operational execution/lifecycle infrastructure. |
| **Gateway** | Non-authoritative capability boundary to model/provider functionality. |
| **Experience** | Human-facing presentation and interaction. |
| **Lab** | External/development experimentation; never Product authority merely by existence. |
| **Specification / Handoff / Design / Package** | Documentation or artifact, never a runtime system. |

Implementation nouns such as **Plan**, **Store**, **Worker**, **Bridge**, **Adapter**, **Index**, **Projection**, and **Snapshot** describe bounded implementation responsibilities. They do not imply independent Product-semantic authority unless a qualified Product design explicitly establishes one.

## 5. Language rules

Prefer the canonical name on first use. The short form may follow when the surrounding scope is unambiguous.

Avoid unqualified phrases such as:

- `conversation system`;
- `AI system`;
- `model system`;
- `truth layer`;
- `decision system`;
- `Solandra system`;
- `V7` when the statement could be mistaken for Product validation.

Examples:

- Prefer: **“The Lattice Decision Engine selected the authorized outcome; Solandra presented the decision.”**
- Avoid: **“Solandra decided the outcome.”**
- Prefer: **“Lattice Intent Authority accepted a USER-supported semantic change and created a new IntentVersion.”**
- Avoid: **“The conversation changed authoritative intent.”**
- Prefer: **“DecisionPlan bound the exact IntentVersion and faithful RunRequest for this Run.”**
- Avoid: **“DecisionPlan decided what the user meant.”**
- Prefer: **“The V7 LLM Simulation Lab passed its standalone simulator test.”**
- Avoid: **“V7 validated Lattice.”**

## 6. Artifact naming

Documents and external packages must be named as artifacts rather than systems. Current examples:

- **Lattice Living Product Design** — the canonical living design document.
- **Lattice System Architecture** — the current implementation structural map; it maps Product systems, bindings, dependency direction, authoritative/durable/derived state, and trust boundaries without replacing the living design.
- **Solandra Offline Prototype UI Specification** — the Owner-approved offline-prototype UI design package/specification; it specifies Solandra and is not Solandra itself.
- **Intent Authority Design Handoff Candidate** — the conversation-drift R&D/design package; it informs Lattice Intent Authority and is not the runtime subsystem.
- **V7 Simulation Results / V7 Research Artifacts** — evidence produced by the V7 LLM Simulation Lab; never label these as Lattice Product validation unless exact Product validation independently establishes that claim.

## 7. Drift rule

When a repository document, test, handoff, or status report uses an old or ambiguous name, correct the terminology without silently changing the underlying authority semantics. A rename does not transfer validation, implementation status, or authority between systems.

When an implementation component such as `DecisionPlan` becomes important enough to appear in architecture diagrams, preserve the canonical authority owner around it. Visibility, durability, or centrality in the call graph does not independently make a component a Product authority.
