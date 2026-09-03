# Lattice Foundational Design Principle

Status: **Owner-approved foundational Product design intent subordinate to `The-Core-Lattice-Philosophy.md`**.

Scope: **Lattice Product-wide**.

This document elaborates the governing philosophy defined by `The-Core-Lattice-Philosophy.md`. The Core Lattice Philosophy is the highest Product-design authority and exclusion test. This document may add precision and qualified detail only where that detail remains aligned with the Core philosophy. If this document, any more-specific Product source, or any implementation conflicts with the Core philosophy, **the Core philosophy governs and the conflicting element must be reconciled or removed**.

This document does not override explicit Owner authority, applicable safety/security/privacy requirements, validation/acceptance rules, or production controls. Those controls constrain execution; they do not redefine the Product philosophy.

## 1. Core philosophy

**Use knowledge to break down barriers.**

Lattice exists to make trustworthy knowledge and decision capability easier for people to reach, understand, and use without requiring them to operate the internal machinery needed to produce it.

The trust condition is equally fundamental:

**Break unnecessary barriers while preserving necessary boundaries.**

The Product should absorb complexity that does not belong to the user while preserving the distinctions, evidence, authority, safeguards, and human control that make the result trustworthy.

## 2. Foundational objective

Lattice should transform natural user intent and available information into trustworthy, usable knowledge and decision support while preserving:

- user intent and provenance;
- evidence and uncertainty;
- semantic authority;
- human control;
- safety, privacy, and security;
- authorization boundaries;
- validation and verification boundaries.

The intended user journey is:

```text
question or objective
        -> understanding
        -> informed decision, when needed and qualified
        -> authorized action, when applicable
```

Not every consultation traverses every stage. Trustworthy knowledge is a complete successful Product outcome; Action Preparation may also proceed without a decision when the action basis does not require decision support.

The user should not need to manually navigate providers, models, workers, orchestration, persistence, truth machinery, decision machinery, or validation machinery simply to obtain useful understanding.

## 3. The foundational filter

Before accepting a material Product change, addition, or update, ask these questions in order:

1. **Barrier** — What meaningful user barrier does this remove or reduce?
2. **Knowledge** — What trustworthy knowledge, understanding, or decision capability becomes easier to reach because of it?
3. **Trust** — Which necessary boundaries must remain intact for the result to be trustworthy?
4. **Authority** — Does the change preserve the canonical semantic owner of intent, execution, truth, decision, and presentation?
5. **User control** — Does the user retain the appropriate control over consequential decisions and actions?
6. **Complexity** — Is the new machinery necessary, or is Lattice transferring internal complexity to the user or architecture without sufficient Product value?
7. **Simplicity** — Could a simpler design produce the same governed outcome with less user or system complexity?
8. **Observability** — How will Product-observable evidence show that the change actually improved the intended outcome?

A proposal that cannot answer the first two questions has not established a Product reason to exist.

A proposal that fails the trust, authority, or user-control questions must not proceed merely because it improves convenience.

When multiple otherwise-compliant designs satisfy the requirement, prefer the design that removes more unnecessary user complexity while introducing less unnecessary system complexity.

## 4. Knowledge, not merely information

Access to information is not equivalent to access to knowledge.

Information can be fragmented, contradictory, stale, incomplete, technically inaccessible, detached from provenance, or difficult for a non-specialist to evaluate.

Lattice should make information usable by determining, where materially relevant:

- what is relevant;
- what is supported;
- where it came from;
- how current it is;
- what conflicts with it;
- what remains uncertain;
- what conclusions it supports;
- what decisions it can responsibly inform.

Lattice does not make uncertainty disappear. It makes uncertainty understandable and keeps unsupported certainty from silently entering authoritative Product state.

## 5. Current semantic ownership

The foundational philosophy is realized through the current canonical Lattice Product boundaries rather than through an abstract collection of agents or experts. The current implementation-level composition is mapped in `docs/design/Lattice-System-Architecture.md`.

```text
User conversation -> Lattice Intent Authority -> exact IntentVersion -> Run -> V36 Truth Core

V36 state -> KnowledgeOutcome
V36 state -> Action Preparation

Qualified decision only:
exact IntentVersion -> DecisionPlan -> Run -> V36
-> decision evidence projection -> Lattice Decision Engine -> DecisionSupportOutcome

All applicable outcomes -> Solandra Experience -> User
```

Every Run binds one exact authoritative `IntentVersion`. `DecisionPlan` is a conditional durable decision binding, not a peer semantic authority or universal Run-planning object. When present, it freezes a faithful projection of all execution-significant USER decision meaning from one exact `IntentVersion`; it cannot create independent USER meaning. Knowledge and non-decision Action Preparation have no DecisionPlan and do not invoke the Decision Engine.

The **Lattice Model Gateway** is a provider-neutral, non-authoritative capability boundary. Models, providers, retrieval systems, adapters, and tools may assist Product systems where qualified designs permit them, but their output does not become user intent, V36 truth, Decision Engine authority, or Product validation merely because it was generated or retrieved.

The canonical ownership rule is:

- **Lattice Intent Authority** owns canonical versioned USER intent and correction lineage.
- **Lattice Execution Runtime** owns durable operational lifecycle, coordination, cancellation, recovery, and research execution.
- **V36 Truth Core** owns authoritative external factual truth/evidence state.
- **Lattice Decision Engine** conditionally owns authoritative eligibility, typed comparison, trade-off, frontier, licensed selection, and `StructuredDecision` semantics when decision work is qualified.
- **Solandra Experience** owns human-facing conversation, advocacy, progress presentation, explanation, and continuation within its fidelity boundary.
- **Lattice Model Gateway** supplies non-authoritative model capability.

A rename, adapter, prompt, process split, storage move, UI placement, provider change, deployment transition, or implementation convenience does not transfer these semantic responsibilities.

## 6. Conversation should hide machinery, not authority

The Product should feel conversational even when the underlying system is complex.

The user normally expresses the objective rather than selecting models, providers, workers, agents, execution routes, persistence strategies, evidence stores, or validation systems.

Conversation is the interaction surface, not a shortcut around semantic ownership.

In particular:

- transcript is context and provenance, not automatically canonical intent;
- model interpretation may propose meaning, but does not silently commit USER intent;
- progress events describe execution, but do not establish truth;
- presentation may explain or advocate, but does not create truth or decision authority.

Lattice should manage the machinery while preserving inspectability for users who need provenance, evidence, uncertainty, or system state.

## 7. Truth, decision, execution, and presentation remain distinct

Different forms of Product state must remain distinguishable because collapsing them makes the system easier to misuse and harder to trust.

The foundational separation is:

> Conversation is not canonical intent.  
> Information is not truth.  
> Truth is not a decision.  
> A decision is not authorization.  
> Authorization is not execution.  
> Execution is not verification.  
> Presentation is not authority.

These distinctions are not bureaucracy for its own sake. They allow Lattice to hide implementation complexity without hiding material epistemic or authority boundaries from the user.

## 8. Evidence, provenance, and uncertainty

Knowledge becomes useful when the user can appropriately trust it.

Lattice should preserve enough provenance to establish, when materially relevant:

- what evidence was used;
- where it originated;
- when it was observed;
- its authority/reliability class;
- unresolved conflicts;
- temporal applicability;
- what Product authority evaluated or admitted it;
- what conclusion or decision consumed it;
- what validation or verification later established.

Evidence requirements should scale with consequence, uncertainty, volatility, reversibility, and domain requirements.

Lattice must not manufacture certainty merely to produce a cleaner or more persuasive answer.

## 9. Human control

Lattice exists to increase the user's access to knowledge and decision capability, not to silently replace the user's agency.

The Product may research, analyze, calculate, compare, challenge assumptions, identify uncertainty, identify risks, recommend, explain, validate, and escalate within its qualified boundaries.

Consequential execution remains subject to the applicable authority and authorization requirements.

Authorization applies to the bounded action presented at that boundary. It does not silently propagate to other actions.

## 10. Capability before provider

Lattice should define the required capability before committing to how that capability is supplied.

Providers, models, APIs, local models, operating systems, applications, connectors, repositories, workflow systems, and tools are mechanisms, not the purpose of Lattice.

Implementation should prefer capability contracts over provider identity where practical and should preserve the ability to replace mechanisms when another qualified mechanism better serves the Product requirement.

Provider or model substitution must not change semantic authority merely because execution moved.

## 11. Internal multiplicity is not a Product objective

Lattice is designed around required capability and trustworthy outcomes, not around maximizing agents, workers, services, models, experts, workflows, or handoffs.

One capability path may be sufficient. Several may be necessary when specialization, independent evidence, adversarial review, reliability, isolation, or materially different competencies improve the governed outcome.

**Internal multiplicity is an implementation consequence, not a Product objective.**

Every additional subsystem, process, provider, workflow, specialist role, review layer, state transition, handoff, or user action must earn its place through meaningful Product value.

## 12. Complexity must earn its place

Every new mechanism creates cognitive, implementation, operational, validation, and maintenance cost.

Complexity is justified when it materially improves one or more of:

- access to useful knowledge;
- truth/evidence quality;
- decision quality;
- user control;
- reliability and recoverability;
- safety, privacy, or security;
- independence where independence actually matters;
- auditability;
- capability that the Product genuinely requires.

For every substantial mechanism ask:

**Is this removing a barrier, protecting a necessary boundary, or merely exposing internal machinery?**

If the answer is primarily the third, simplification is preferred.

## 13. Self-correction without rewriting history

Knowledge, evidence, user intent, and Product understanding can change.

Lattice should be capable of revisiting prior conclusions when new evidence appears, evidence becomes stale, contradictions are discovered, USER intent changes, a defect is identified, a better qualified capability becomes available, or governing Product requirements change.

Historical state and provenance should remain inspectable. Correction should create explicit lineage or reconciliation rather than pretending the earlier state never existed.

## 14. Knowledge accessibility

Correctness alone is insufficient if the user cannot understand or use the result.

Lattice should translate expert or technical material into forms appropriate to the person and task without corrupting the underlying meaning.

That may require bridging:

- technical language and ordinary language;
- raw evidence and useful explanation;
- uncertainty and understandable risk;
- competing considerations and concrete choices;
- system state and user intent.

Simplification must not hide material limitations. Accessibility must not come at the cost of truth or authority integrity.

## 15. Solandra experience principle

The external experience should be substantially simpler than the internal system.

The preferred interaction is:

1. The user expresses an objective conversationally.
2. Lattice Intent Authority determines and preserves the authoritative structured meaning, asking only material clarifications.
3. Lattice Execution Runtime performs the required durable operational work bound to that exact IntentVersion, retaining useful conversational work context without promoting it into intent.
4. V36 Truth Core qualifies and admits material external factual evidence into generic truth state.
5. Knowledge work produces a KnowledgeOutcome; non-decision Action Preparation produces a Resource.
6. Only qualified decision work creates a faithful DecisionPlan, projects decision-specific evidence from V36 state, and invokes the Decision Engine.
7. Solandra Conversation carries questions, clarifications, acknowledgements, and concise explanations; Composer presents the most useful trustworthy visual material currently available.
8. The user intervenes where judgment, correction, or authorization genuinely requires them.

Internal complexity should be available for audit without becoming mandatory for ordinary use.

## 16. Product design decision order

Once governing authority, safety, and requirement qualification permit a Product change to be considered, evaluate compliant alternatives in this order:

1. **Foundational alignment** — does it use knowledge to remove a meaningful barrier?
2. **Trustworthiness** — does it preserve evidence, uncertainty, provenance, authority, and safeguards?
3. **User outcome** — does it improve understanding, decision quality, or appropriate actionability?
4. **Semantic integrity** — does each canonical Product authority retain its responsibility?
5. **Human control** — does the user retain appropriate agency?
6. **Capability fit** — does the work reach the capability genuinely required without promoting a mechanism into authority?
7. **Complexity** — does each new mechanism earn its cost?
8. **Experience** — can Lattice absorb the complexity rather than forcing the user to manage it?
9. **Product-observable proof** — can the claimed improvement be demonstrated rather than inferred from architecture alone?

This order does not weaken more-specific qualified requirements, provided those requirements themselves remain aligned with `The-Core-Lattice-Philosophy.md`. No lower-level requirement can authorize a Product direction that fails the Core philosophy.

## 17. Change rule

This foundational principle should be unusually stable.

A material change to it requires explicit Owner consideration of:

- which principle is changing;
- why the current principle no longer expresses the intended Product;
- evidence or Product need supporting the change;
- impact on canonical architecture and semantic ownership;
- affected qualified Product sources;
- migration or reconciliation consequences.

Feature development, refactoring, implementation convenience, provider changes, UI redesign, deployment topology, or new model capability must not silently redefine the foundational objective or the Core Lattice Philosophy above it.

## 18. Relationship to other Product sources

This document is a detailed foundational elaboration beneath `The-Core-Lattice-Philosophy.md`. It is not the highest Product-design authority and must remain consistent with the Core philosophy.

After a proposal passes the Core philosophy and this foundational filter:

- the canonical living design controls confirmed Product direction and forward sequencing;
- the Lattice System Architecture document provides the concise current implementation structural map;
- the System Registry and Naming document controls canonical Product system vocabulary and ownership names;
- Lattice Architecture Integrity preserves semantic ownership across implementation evolution;
- qualified SPEC-1 contracts govern detailed behavior where not superseded;
- protected V36 specifications govern V36 semantics;
- exact current repository state establishes what is actually implemented;
- executed Product-observable validation establishes what behavior has actually been demonstrated.

Every source in that hierarchy remains subordinate to the Core Lattice Philosophy. A proposal can be philosophically aligned and still be unauthorized, incorrectly designed, unimplemented, unvalidated, or unsafe. Passing the Core philosophy is necessary for Product belonging; subordinate requirements determine whether an aligned proposal is correctly specified, implemented, and accepted.

---

## Foundational test

For every material Lattice Product change, addition, or update:

> **Does this use knowledge to remove a meaningful barrier for the user, preserve the boundaries required for trust and human control, keep semantic authority where it belongs, and reduce rather than transfer unnecessary complexity?**

If yes, continue through the applicable qualified Product requirements, architecture, implementation, and validation gates.

If not, **do not proceed**. A more-specific Product source cannot override the Core philosophy. The proposal, requirement, or existing implementation must instead be reconciled or removed until Lattice is philosophically aligned.
