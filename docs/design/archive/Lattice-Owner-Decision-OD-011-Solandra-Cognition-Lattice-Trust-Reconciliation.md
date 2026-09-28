# Lattice Owner Decision OD-011 — Solandra Cognition / Lattice Trust Reconciliation

Status: **OWNER-DIRECTED CURRENT PRODUCT DECISION**

Effective date: **2026-09-08**

Repository reconciliation base: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

Scope: Product architecture and design reconciliation only. This decision does not claim runtime implementation, validation, provider qualification, production readiness, or authorization for consequential external action.

## 1. Authority

`The-Core-Lattice-Philosophy.md` remains unchanged and is the highest Product-design authority. OD-011 records the Owner's current architecture direction beneath that Core.

Where an older Owner-approved decision, architecture document, acceptance contract, naming rule, roadmap statement, or historical package conflicts with OD-011, the conflicting portion is superseded for current Product direction. The older material remains historical provenance and must remain inspectable.

## 2. Current architecture decision

The current target architecture is:

- **Solandra = cognition** — ordinary-language understanding, conversational context, reference resolution, planning, investigation strategy, advisory reasoning, recommendation, capability coordination, and natural explanation.
- **Lattice = trust** — intent integrity, governed Knowledge/provenance/uncertainty, accepted USER choice when exact choice matters downstream, authorization, durable safety/recovery, execution governance, and verification.
- **Models, sources, algorithms, and tools = capabilities** — bounded mechanisms used by Solandra through Lattice-owned trust and execution boundaries.

These are logical planes. Lattice remains a one-owner hobby project and should prefer a modular monolith unless observed reliability, safety, capability, or operational evidence justifies physical separation.

## 3. Solandra cognition

Solandra is no longer presentation-only. Current Product direction permits Solandra to:

- understand ordinary language and conversational context;
- maintain hypotheses about objective, constraints, preferences, entities, referents, material ambiguity, and useful next work;
- propose intent interpretations and clarification questions;
- identify Knowledge needs and plan investigation;
- reason over governed Knowledge and known uncertainty;
- compare alternatives and make advisory Recommendations;
- coordinate bounded capabilities, including a user-authorized model;
- prepare ActionProposals; and
- explain results naturally through Conversation and Composer.

Solandra cognition does not make Solandra truth authority, USER-choice authority, authorization authority, execution authority, or verification authority.

## 4. Intent Integrity replaces universal language-understanding ownership

Solandra performs semantic understanding. Lattice owns **Intent Integrity**: what the Product is justified in treating as established USER intent.

Preserved rules:

- conversation/transcript is not canonical intent;
- model interpretation is not USER provenance;
- explicit USER correction creates durable lineage rather than rewriting history;
- material ambiguity that could change truth, recommendation/formal decision, USER choice, or consequential action fails closed to clarification/confirmation;
- model confidence cannot become USER authority.

Narrowed rule:

- deterministic Intent Authority machinery is not the universal conversational intelligence engine. Ordinary reasonable interpretation may proceed without ritual confirmation when the supported meaning is materially sufficient and no material ambiguity requires clarification.

Existing `IntentVersion`-style provenance/versioning mechanisms may remain implementation foundations for this trust boundary.

When the person's actual decision or choice materially matters downstream, Intent Integrity may preserve an exact accepted `AcceptedChoice`. That is governed USER state, not a new subsystem, not Solandra's Recommendation, and not action Authorization.

## 5. Knowledge is a first-class trust object

Lattice must support durable governed Knowledge with traceable provenance:

```text
Source -> Evidence -> Claim -> Knowledge
```

Material Knowledge should preserve support/refutation/conflict/insufficiency, source/provenance identity, currency/temporal applicability, uncertainty, unresolved boundaries, and the exact basis consumed by later Recommendations or actions.

Raw retrieval, provider output, model output, or repeated agreement is information, not automatically Knowledge. Existing V36 Truth Core semantics remain protected where they implement this epistemic boundary.

## 6. General recommendation reasoning moves to Solandra

Ordinary advisory reasoning is performed by Solandra over:

- governed intent;
- governed Knowledge;
- USER constraints/preferences;
- known uncertainty; and
- optional qualified capabilities.

A durable `Recommendation` is advisory Product state. It is not USER intent, factual truth, the person's accepted Decision/Choice, authorization, execution, or verification.

The Lattice Decision Engine is no longer the universal authority required for ordinary advice or recommendation.

### 6.1 USER Decision/Choice remains distinct

The Core distinction that truth is not a decision and a decision is not authorization remains explicit.

When a person actually chooses among recommendations/options and preserving that exact choice matters downstream, Lattice may record an optional `AcceptedChoice` under Intent Integrity.

```text
Knowledge != Recommendation
Recommendation != AcceptedChoice
AcceptedChoice != Authorization
```

`AcceptedChoice` is intentionally small. It may bind the exact referenced option/outcome, actual USER provenance, and relevant Intent/freshness basis. It does not create a new “Decision Authority,” does not require the formal Decision Engine, and does not authorize external execution.

## 7. Formal Decision Engine becomes an optional qualified capability

The formal Decision Engine remains valid where its typed guarantees materially help, including qualified constraint solving, typed comparison, optimization, material-dominance/frontier analysis, statistics, routing, or other formally defined domains.

The following OD-003 semantics are preserved **inside that qualified formal capability**:

- hard requirements remain distinct from preferences;
- `MUST_HAVE` priority does not automatically become a hard requirement;
- requirement evidence remains tri-state where qualified;
- incompatible raw scales are not summed as though commensurable;
- material-dominance frontier/tie/uncertainty may be preserved rather than forcing a winner;
- any formal selected outcome requires its own qualified basis.

What is superseded is the claim that this formal path is the universal semantic source of ordinary Recommendation state.

## 8. ConversationReference is first-class target state

Conversation continuity must not reconstruct authority from prose or re-run old investigation merely to recover provenance.

Meaningful Solandra turns should retain references to governed objects they consumed or produced, such as:

```text
ConversationReference
  -> Intent
  -> Knowledge
  -> Recommendation
  -> AcceptedChoice
  -> ActionProposal
  -> Authorization
  -> ExecutionReceipt
  -> Verification
```

This enables grounded follow-ups such as:

- “Explain that” -> the exact referenced Recommendation/Knowledge object;
- “What were your sources?” -> the actual Knowledge -> Evidence -> Source provenance used then;
- “What about the second option?” -> the exact referenced alternative/basis;
- “I’ll take the second one” -> the exact referenced option may become an AcceptedChoice through Intent Integrity when downstream trust requires it;
- “Do it” -> the exact current ActionProposal or a new proposal derived from the referenced Recommendation/AcceptedChoice, never a prose-only execution authorization.

## 9. Capability architecture

Solandra consumes capabilities by Product purpose, not provider mechanics. A capability contract should expose the equivalent of:

```text
id
description
input contract
output contract
permissions required
side effects
verification method
```

Existing Execution Runtime machinery may implement durable work, retries, cancellation, idempotency, stale-result rejection, budgets, and operational provenance behind this interface. Providers, workers, queues, model routes, and Runs remain implementation machinery unless a trust/reliability boundary genuinely requires Product exposure.

The user-authorized model is one cognitive capability available to Solandra. Its output remains proposed work until the applicable Lattice trust boundary accepts it.

## 10. Consequential action chain

The current trust chain is explicitly:

```text
Knowledge
  != Recommendation

Recommendation
  != AcceptedChoice

AcceptedChoice
  != Authorization

Recommendation
  != ActionProposal

ActionProposal
  -> Authorization
  -> Execution
  -> ExecutionReceipt
  -> Verification
```

Rules:

- Recommendation is advisory.
- AcceptedChoice, when present, records what the USER actually chose; it is not Authorization.
- ActionProposal is exact prepared execution intent, not authority.
- Authorization must be narrow, current, and bound to the exact consequential proposal where required.
- Authorization is not execution.
- Executor does not decide whether it was allowed to act.
- Execution is not verification.
- ExecutionReceipt is an operational report, not verified reality.
- Completion is represented as verified only when Lattice has sufficient independent evidence of the intended resulting state.
- If independent verification is unavailable, the limitation remains explicit.
- Ambiguous consequential completion fails closed; it must not invite blind duplicate execution.

## 11. Architecture Integrity now protects boundaries, not historical topology

The protected distinctions include:

```text
conversation != canonical intent
interpretation != USER authority
information != Knowledge/truth
Knowledge/truth != Recommendation
Recommendation != accepted USER Decision/Choice
accepted USER Decision/Choice != Authorization
Recommendation != ActionProposal
ActionProposal != Authorization
Authorization != Execution
Execution != Verification
ExecutionReceipt != Verification
presentation != authority
capability != authority
```

Architecture Integrity must not block Solandra cognition merely because an older topology assigned semantic work to other components.

## 12. Explicit reconciliation of earlier Owner decisions

### OD-001 — 1.0 Product shape

**Preserved:** trustworthy Knowledge is a complete Product outcome; not every consultation requires formal decision machinery.

**Superseded/narrowed:** any residual clause implying ordinary recommendation must be produced by the formal Decision Engine.

### OD-002 — V36 durable continuation

**Preserved unchanged:** protected evidence/provenance/truth continuation, immutable checkpointing, and separation of operational execution from epistemic authority.

### OD-003 — formal generalized Decision Engine semantics

**Preserved as optional qualified capability semantics.**

**Superseded:** its use as universal Recommendation authority for ordinary advisory cognition.

### OD-004 — Intent Authority

**Preserved:** exact USER provenance, immutable/versioned intent lineage, correction, material clarification, exact downstream binding, and fail-closed treatment of material unsupported inference.

**Narrowed:** Intent Authority becomes Intent Integrity rather than the universal language-understanding/cognitive engine. Solandra performs ordinary semantic understanding and proposes meaning. Accepted USER Decision/Choice may be preserved under this same trust boundary when materially needed downstream; it does not create a new universal decision authority.

### OD-007 — M8 continuity

**Preserved:** authenticated subject isolation, deletion/retention boundary, explicit USER-authored/confirmed preference continuity, and prohibition on silently reusing historical external facts as current truth.

### Solandra v0.8 continuous interaction correction

**Preserved:** Conversation + free-form ConversationInput + adaptive Composer, no fixed presentation-stage/global-gate UX, no-riddle behavior, and domain-independent interaction.

**Superseded:** presentation-only semantic ownership language where it conflicts with Solandra's current cognitive role.

## 13. No implementation claim

OD-011 changes current Product direction and the design corpus only. At the base revision, existing runtime code still reflects substantial portions of the predecessor architecture. A later bounded implementation handoff must establish cognition, durable Knowledge, optional AcceptedChoice, ConversationReference, capability brokerage, Recommendation, Authorization, ExecutionReceipt, and Verification behavior with exact runtime evidence.
