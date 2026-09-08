# Lattice Intent Integrity, Recommendation, and Formal Decision Architecture

Status: **OWNER-DIRECTED CROSS-SYSTEM SEMANTIC ARCHITECTURE — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Repository design baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This document is subordinate to the Core and current Owner decision OD-011.

## 1. Purpose

This document defines the boundary among:

- Solandra semantic understanding;
- Lattice Intent Integrity;
- governed Knowledge;
- ordinary advisory Recommendation;
- accepted USER Decision/Choice when exact choice materially matters downstream; and
- the optional formal Decision Engine capability.

The central rule is:

> **Solandra may infer and reason; Lattice preserves what may be treated as established USER meaning and governed Knowledge. A Solandra Recommendation is not the person's decision, and the person's decision is not action Authorization. Formal decision machinery is used only when its guarantees are actually needed.**

## 2. Canonical ordinary path

```text
USER expression
 -> Conversation provenance
 -> Solandra semantic understanding
 -> interpretation / hypothesis
 -> Intent Integrity checks
 -> canonical Intent
 -> Knowledge acquisition/trust as needed
 -> Solandra reasoning
 -> Recommendation or Knowledge-only outcome
 -> ConversationReference
 -> Conversation / Composer
```

No `DecisionPlan` or formal Decision Engine is required on this ordinary path.

When the person later makes a materially relevant choice, that is a separate USER-state transition:

```text
Recommendation / alternatives
 -> Conversation / Composer
 -> USER chooses
 -> Intent Integrity
 -> optional AcceptedChoice
```

`AcceptedChoice` is needed only when preserving the exact USER choice materially helps downstream trust, continuity, or action preparation. It is not a universal state requirement.

## 3. Conversation and interpretation

Conversation contains USER-authored text and Solandra responses. It is context and provenance, not canonical intent by itself.

Solandra may infer:

- probable objective;
- constraints;
- preferences;
- entities/referents;
- corrections;
- missing context;
- likely task type;
- material ambiguity.

Those inferences may drive conversational behavior, but they do not silently become USER authority.

## 4. Intent Integrity

Intent Integrity answers:

> **What meaning is the Product justified in relying on as the USER's intent?**

It preserves the strongest parts of the previous Intent Authority design:

- explicit USER provenance;
- immutable/versioned lineage;
- `SET`, `REMOVE`, and `NO_CHANGE`-style non-destructive semantics where applicable;
- omission does not mean removal;
- exact correction history;
- freshness/base-version/message-horizon protection where needed;
- material clarification/confirmation;
- exact downstream basis binding.

### 4.1 Ordinary reasonable interpretation

The Product should not require confirmation ceremony for every reasonable interpretation.

Solandra may proceed on an ordinary materially sufficient interpretation when:

- the meaning is supported by the USER's actual expression/context;
- no unresolved alternative would materially change truth/research scope, Recommendation/formal decision, or consequential action; and
- the Product can safely preserve the interpretation/provenance distinction required by the affected trust boundary.

### 4.2 Material ambiguity

Clarification/confirmation is required when unresolved meaning could materially change:

- what claims must be established;
- applicable constraints;
- meaningful Recommendation outcomes;
- a formal decision result;
- target/recipient/arguments of a consequential action; or
- the scope of authorization.

A generic `yes` binds only the exact fresh proposition it unambiguously answers.

## 5. Intent vocabulary

Keep these concepts distinct:

- **Objective** — what the person is trying to accomplish.
- **Requirement** — USER meaning that must be satisfied where represented.
- **Preference** — relative desirability, not automatic eligibility.
- **Constraint** — an authoritative restriction applied by an applicable qualified boundary.
- **Tolerance** — USER meaning about materially meaningful differences where representable.
- **Delegation** — scoped permission to let Lattice/Solandra choose or act, never implied from silence.
- **AcceptedChoice** — optional governed USER state recording what the person actually chose when exact choice materially matters downstream.

Intent meaning remains separate from factual evidence about whether the world satisfies that meaning.

## 6. Knowledge boundary

External-world facts used for reasoning must come from governed Knowledge, not raw conversation/model/provider output.

```text
Source -> Evidence -> Claim -> Knowledge
```

A USER statement about the world may become a research lead or USER_ONLY context under the applicable contract; it is not automatically externally verified Knowledge.

Intent uncertainty and evidence uncertainty remain separate.

## 7. General Recommendation

A `Recommendation` is advisory Product state produced by Solandra from the exact governed basis.

Conceptually:

```text
Recommendation {
  recommendationId
  intentRefs[]
  knowledgeRefs[]
  assumptions[]
  alternatives[]
  rationale
  materialUncertainty[]
  createdAt
}
```

Exact schema is future implementation work.

A Recommendation may express:

- one preferred path;
- several credible alternatives;
- a conditional recommendation;
- a trade-off;
- a need for more Knowledge; or
- an explicit inability to recommend responsibly.

Recommendation is not truth, USER intent, accepted USER Decision/Choice, authorization, or execution.

## 8. Solandra reasoning responsibilities

Solandra may:

- synthesize governed Knowledge;
- identify decision-relevant assumptions;
- compare alternatives;
- reason about preference sensitivity;
- choose what additional Knowledge could materially change the advice;
- produce advisory Recommendations;
- explain why a Recommendation follows from its basis;
- revise a Recommendation when the governed basis changes.

Solandra must preserve material uncertainty rather than invent certainty for narrative convenience.

## 9. Optional formal Decision Engine

The formal Lattice Decision Engine is a **qualified capability**, not the universal recommendation path.

Invoke it when a problem materially benefits from formal semantics such as:

- typed hard constraints;
- criterion-specific utility/comparison;
- optimization;
- material-dominance/frontier analysis;
- formal tie/unknown handling;
- statistics or other algorithmic guarantees.

A formal invocation should bind exact qualified inputs and produce an attributable structured result. Solandra consumes that result as governed capability output and may explain/reason around it without changing its formal semantics.

## 10. Formal-branch invariants preserved from OD-003

When the formal Decision Engine is used:

1. `requirement != preference`.
2. `MUST_HAVE priority != hard requirement` unless separately represented as one.
3. hard-requirement evaluation remains tri-state where qualified (`SATISFIED | FAILED | UNKNOWN`).
4. `UNKNOWN` does not become pass or zero utility.
5. incompatible raw scales are not summed as though comparable.
6. evidence strength is not increased by USER preference strength.
7. a material-dominance frontier/tie/unresolved state may remain multi-option.
8. presentation/Solandra reasoning must not fabricate a formal winner absent valid formal state.

These are capabilities of the formal branch, not universal ontology for every Recommendation.

## 11. DecisionPlan

`DecisionPlan` remains a valid implementation object **only when a qualified formal decision invocation needs an immutable faithful binding**.

It is not required for Knowledge-only work, ordinary advice, or Action Preparation by default.

DecisionPlan has no independent USER, truth, recommendation, choice, or authorization authority.

## 12. USER Decision/Choice, delegation, and action

A person may choose an option conversationally without granting consequential execution authority.

When an exact choice materially matters downstream, Lattice may preserve an `AcceptedChoice` under Intent Integrity. This is the smallest governed record needed to distinguish what the person actually chose from what Solandra recommended.

Conceptually:

```text
Recommendation != AcceptedChoice
AcceptedChoice != Authorization
```

An `AcceptedChoice` may bind the selected referenced option/outcome, relevant Intent basis, USER provenance, and freshness needed to prevent later ambiguity. Exact schema is future implementation work.

Any scoped choice/delegation state remains separate from:

- Recommendation;
- ActionProposal;
- Authorization; and
- Execution.

A formal selected outcome, Solandra Recommendation, or accepted USER choice can inform creation of an ActionProposal. None automatically authorizes the external action.

Accepting or recording a USER choice does not require the formal Decision Engine.

## 13. ConversationReference

ConversationReference binds natural follow-up language to the exact prior governed objects.

Examples:

- “Explain that” -> referenced Recommendation or Knowledge.
- “Why that one?” -> referenced Recommendation alternative/basis.
- “What were your sources?” -> referenced Recommendation -> Knowledge -> Evidence -> Source.
- “I’ll take the second one” -> referenced alternative may become an `AcceptedChoice` through Intent Integrity when that exact choice matters downstream.
- “Do it” -> referenced ActionProposal if one exists and remains current, otherwise prepare a new exact ActionProposal from the referenced advisory/choice state.

Reference resolution is cognition. Authority still belongs to the referenced object's owning trust boundary.

## 14. Staleness and revision

- USER correction creates successor Intent state; historical Intent is not rewritten.
- New Knowledge may justify a successor Recommendation; the old Recommendation remains historical with its old basis.
- A later USER choice does not rewrite the historical Recommendation that preceded it.
- A later formal criterion/version/evidence basis must not silently reinterpret an old formal result.
- Conversation wording changes do not mutate governed objects unless the appropriate semantic boundary accepts a real change.

## 15. Presentation boundary

Solandra is both cognitive and human-facing. The Composer may organize and explain Intent, Knowledge, Recommendation, accepted USER choice, formal results, Resources, ActionProposals, and Verification.

Presentation must remain faithful to each object's status. Visual emphasis cannot upgrade proposal to intent, information to Knowledge, Recommendation to USER Decision/Choice, USER Decision/Choice to Authorization, Recommendation to Authorization, or ExecutionReceipt to Verification.

## 16. Validation direction

Later implementation evidence should prove:

1. Solandra can interpret ordinary language without every turn becoming an Intent Authority ritual.
2. materially ambiguous meaning still fails closed to clarification.
3. unsupported model inference cannot silently commit canonical Intent.
4. Knowledge-only work bypasses formal Decision Engine machinery.
5. ordinary Recommendation can complete without a DecisionPlan/Decision Engine.
6. Recommendation remains attributable to exact Intent/Knowledge basis.
7. accepted USER Decision/Choice is distinguishable from both Recommendation and Authorization when exact choice matters downstream.
8. formal Decision Engine can still be invoked and preserves its formal invariants.
9. ConversationReference resolves prior recommendations/sources/choices without prose reconstruction.
10. Recommendation or USER choice cannot authorize external action.
11. correction/new Knowledge creates successor state rather than rewriting history.

This design reconciliation alone establishes none of those runtime behaviors.
