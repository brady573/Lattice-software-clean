# Lattice Foundational Design Principle

Status: **OWNER-APPROVED FOUNDATIONAL ELABORATION — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

`The-Core-Lattice-Philosophy.md` remains unchanged and is the highest Product authority. This document elaborates that Core and must never be used to override it. Current Owner decision OD-011 controls cognition/trust allocation where older topology conflicts.

## 1. Product purpose

Lattice should reduce the cognitive and operational burden between a person's need and a trustworthy useful outcome.

The Product should absorb machinery the person should not have to manage: provider choice, task routing, retries, evidence bookkeeping, state recovery, formal algorithms, and execution mechanics.

The user experience should remain a natural relationship with Solandra, not a control panel for those mechanisms.

## 2. Current foundational composition

The current design is:

> **Solandra is the intelligent expert. Lattice is the trust system behind her. Capabilities are replaceable mechanisms.**

Solandra may understand, reason, plan, investigate, recommend, coordinate capabilities, and explain. Lattice determines what the Product may responsibly treat as established USER intent, governed Knowledge, authorized action, and verified outcome.

This separation permits rich cognition without turning model output into authority.

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

## 4. Solandra cognition should be natural, not ritualized

Ordinary language understanding belongs in Solandra cognition.

Lattice Intent Integrity should intervene when it materially protects the person:

- unsupported material interpretation;
- ambiguity that could change truth/research scope;
- ambiguity that could change recommendation/formal decision;
- ambiguity that could change a consequential action;
- explicit correction or conflicting USER provenance.

The Product should not force repeated confirmation merely to make deterministic machinery feel safe when the meaning is already materially clear.

## 5. Knowledge before confidence theater

Information becomes governed Knowledge only through a qualified trust process. Material Knowledge preserves evidence, provenance, uncertainty, conflicts, and temporal applicability.

Prefer inspectable support over generic confidence meters, source counts, provider reputation, or model certainty.

Existing V36 protected semantics remain valuable because they make this boundary concrete.

## 6. Advisory reasoning and formal algorithms

Solandra performs ordinary advisory reasoning and produces Recommendations over governed Intent and Knowledge.

Formal deterministic algorithms should be used when their guarantees materially help: calculations, optimization, typed constraints, statistics, routing, formal comparison, or other bounded problems.

The existence of a formal Decision Engine does not make formal decision machinery the universal path for ordinary advice.

## 7. Human control

The Product should help the person act without quietly taking authority away from them.

Preparation can be broad. Consequential execution remains narrow and explicit where required:

```text
ActionProposal -> Authorization -> Execution -> ExecutionReceipt -> Verification
```

Authorization is scoped to the action. Execution is not verification. Ambiguous completion fails closed.

## 8. Capability before provider

Define what the Product needs to accomplish before selecting a provider/model/tool.

A capability should have bounded input/output, permissions, side effects, privacy/egress constraints, and a verification method where relevant. Provider identity is operational provenance, not semantic authority.

The user's chosen model may be a strong cognitive capability. Its output remains proposed work until the applicable Lattice boundary accepts it.

## 9. Hide machinery, preserve meaningful boundaries

Users should not need to reason about Runs, workers, queues, checkpoints, model routes, leases, retries, or provider-specific workflows.

Those mechanisms may remain visible to diagnostics and acceptance evidence. They should surface in the Product only when a concrete trust/recovery consequence matters to the user.

The primary UX remains continuous Conversation + free-form ConversationInput + adaptive Composer.

## 10. Durable continuity should preserve governed meaning

A conversation cannot be intelligent over time if the Product remembers only prose.

Durable state should preserve governed objects and references sufficient to answer follow-ups from the actual prior basis:

- Intent;
- Knowledge and provenance;
- Recommendation;
- ActionProposal/Authorization/ExecutionReceipt/Verification where applicable;
- ConversationReference linking turns to those objects.

Do not re-search merely to fabricate provenance for an old answer, and do not reconstruct authority from generated explanation text when governed state exists.

## 11. Simplicity for a one-owner project

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

## 12. Product design filter

Before adding a subsystem, state, workflow, or UI element, ask:

1. Does it materially help Solandra understand, help, or act for the person?
2. Does it materially improve trust, safety, provenance, recovery, or verified completion?
3. Can an existing boundary/mechanism carry the requirement more simply?
4. Does it make the person manage machinery Lattice should absorb?
5. Does it preserve the Core distinctions and human control?

If the new complexity cannot answer those questions well, do not add it.
