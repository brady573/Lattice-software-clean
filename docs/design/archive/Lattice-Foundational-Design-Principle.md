# Lattice Foundational Design Principle

Status: **OWNER-APPROVED FOUNDATIONAL ELABORATION — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Realigned: **2026-09-28** to the adopted Core (`Trustworthy Intelligence for Action`: Question → Understanding → Confidence → Action). Organizing spine re-derived from the Core; no new Product requirements added.

`The-Core-Lattice-Philosophy.md` remains unchanged and is the highest Product authority. This document elaborates that Core and must never be used to override it. Current Owner decision OD-011 controls cognition/trust allocation where older topology conflicts. Concrete scenarios, numbers, and sample phrasings anywhere in this elaboration are illustrative and non-normative; if an example conflicts with a Core principle, the principle governs.

## 1. Product purpose

Lattice should make trustworthy intelligence usable by anyone — helping a person move through Question → Understanding → Confidence → Action by reducing the Distance to Confident Action: the meaningful uncertainty remaining between the person's current state and an informed action.

The Product should absorb machinery the person should not have to manage: provider choice, task routing, retries, evidence bookkeeping, state recovery, formal algorithms, and execution mechanics.

The user experience should remain a natural relationship with Solandra, not a control panel for those mechanisms.

## 2. Current foundational composition

The current design is:

> **Solandra is the intelligent expert. Lattice is the trust system behind her. Capabilities are replaceable mechanisms.**

Solandra may understand, reason, plan, investigate, recommend, coordinate capabilities, and explain. Lattice determines what the Product may responsibly treat as established USER intent, governed Knowledge, authorized action, and verified outcome.

This separation permits rich cognition without turning model output into authority. The intelligence belongs in the system, the decision belongs to the user, and trust is earned by the quality of what happens in between.

## 3. Trust before convenience

Lattice should be helpful as early as it can be helpful **without pretending to know, decide, authorize, or verify more than it actually does**.

Core distinctions remain explicit:

```text
conversation != canonical intent
information != Knowledge
Knowledge != Recommendation
Recommendation != Authorization
Authorization != Execution
ExecutionReceipt != Verification
```

A polished interface or powerful model does not erase these distinctions.

## 4. Epistemic states organize the interior

The system should internally distinguish what it knows and why:

- **Known:** supported directly by sufficiently reliable evidence.
- **Inferred:** not stated directly, but reasonably follows from available evidence.
- **Assumed:** must be true for the current reasoning to hold, but has not been established.
- **Unknown:** insufficient evidence to determine the answer; an unknown is a roadmap (what is missing, why it matters, what would resolve it, whether safe action is still possible).
- **Contested:** credible sources or interpretations disagree; disagreement is preserved and contextualized, never averaged into artificial certainty.

These distinctions should exist throughout the architecture. They do not need to be constantly displayed to the user.

## 5. Confidence shapes language and action invisibly

Confidence should emerge from evidence — its quality, coverage, agreement, and the reasoning distance between evidence and conclusion — not from how certain the model sounds.

The system should express epistemic strength naturally through language rather than dashboards, and let uncertainty influence behavior: low confidence favors reversible, inexpensive, diagnostic moves (investigate); moderate confidence favors tests; high confidence may support consequential action — with the exact tolerance scaled to the consequences. Verification should happen before presentation when the consequences justify it, and evidence visibility should grow with the importance and uncertainty of the decision.

## 6. Solandra cognition should be natural, not ritualized

Ordinary language understanding belongs in Solandra cognition.

Lattice Intent Integrity should intervene when it materially protects the person:

- unsupported material interpretation;
- ambiguity that could change truth/research scope;
- ambiguity that could change recommendation/formal decision;
- ambiguity that could change a consequential action;
- explicit correction or conflicting USER provenance.

The Product should not force repeated confirmation merely to make deterministic machinery feel safe when the meaning is already materially clear. Every question asked of the user should carry meaningful information value — changing what the system believes, what evidence it gathers, or what action it recommends.

## 7. Knowledge before confidence theater

Information becomes governed Knowledge only through a qualified trust process. Material Knowledge preserves evidence, provenance, uncertainty, conflicts, and temporal applicability.

Prefer inspectable support over generic confidence meters, source counts, provider reputation, or model certainty.

Existing V36 protected semantics remain valuable because they make this boundary concrete. Retrieval does not equal verification; sources must be evaluated in context (primary or secondary, authoritative for the claim, current, actually independent).

## 8. Advisory reasoning and formal algorithms

Solandra performs ordinary advisory reasoning and produces Recommendations over governed Intent and Knowledge.

Formal deterministic algorithms should be used when their guarantees materially help: calculations, optimization, typed constraints, statistics, routing, formal comparison, or other bounded problems.

The existence of a formal Decision Engine does not make formal decision machinery the universal path for ordinary advice.

## 9. Human control

The Product should help the person act without quietly taking authority away from them. The system organizes complexity, surfaces evidence, exposes assumptions, and suggests possible actions; the person provides context, determines goals, chooses acceptable risk, and ultimately decides.

Preparation can be broad. Consequential execution remains narrow and explicit where required:

```text
ActionProposal -> Authorization -> Execution -> ExecutionReceipt -> Verification
```

Authorization is scoped to the action. Execution is not verification. Ambiguous completion fails closed.

## 10. Capability before provider

Define what the Product needs to accomplish before selecting a provider/model/tool.

A capability should have bounded input/output, permissions, side effects, privacy/egress constraints, and a verification method where relevant. Provider identity is operational provenance, not semantic authority.

The user's chosen model may be a strong cognitive capability. Its output remains proposed work until the applicable Lattice boundary accepts it. Models are replaceable; the durable value is the machinery governing evidence, reasoning, uncertainty, and action.

## 11. Progressive disclosure: hide machinery, preserve meaningful boundaries

Users should not need to reason about Runs, workers, queues, checkpoints, model routes, leases, retries, or provider-specific workflows.

The default experience stays simple — what was found, what matters, what to do next — with deeper layers (sources, assumptions, supporting and conflicting evidence, alternative explanations, reasoning) available on demand. Scrutiny must always be possible without being mandatory: do not force verification on the user, but never prevent it.

Those mechanisms may remain visible to diagnostics and acceptance evidence. They should surface in the Product only when a concrete trust/recovery consequence matters to the user.

The primary UX remains continuous Conversation + free-form ConversationInput + adaptive Composer.

## 12. Durable continuity should preserve governed meaning

A conversation cannot be intelligent over time if the Product remembers only prose.

Durable state should preserve governed objects and references sufficient to answer follow-ups from the actual prior basis:

- Intent;
- Knowledge and provenance;
- Recommendation;
- ActionProposal/Authorization/ExecutionReceipt/Verification where applicable;
- ConversationReference linking turns to those objects.

Do not re-search merely to fabricate provenance for an old answer, and do not reconstruct authority from generated explanation text when governed state exists.

## 13. Simplicity for a one-owner project

Prefer:

- modular monolith;
- small explicit contracts;
- reusable existing trust/recovery mechanisms;
- focused tests;
- reversible changes;
- zero-cost tooling where practical.

Avoid:

- microservices without evidence;
- agent orchestration for its own sake;
- duplicate state/authority stores;
- one formal pipeline per domain;
- provider-shaped architecture;
- abstractions whose primary benefit is hypothetical future scale or team organization.

## 14. Product design filter

Before adding a subsystem, state, workflow, or UI element, ask the north-star triple:

1. **What do we know?** Does it materially help Solandra understand, help, or act for the person?
2. **How do we know it?** Does it materially improve trust, safety, provenance, recovery, or verified completion?
3. **What can we responsibly do because of it?** What Distance to Confident Action does it shorten — and can an existing boundary/mechanism carry the requirement more simply?

Further: does it make the person manage machinery Lattice should absorb? Does it preserve the Core distinctions and human control?

If the new complexity cannot answer those questions well, do not add it.
