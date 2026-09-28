# Solandra Primary Interaction Contract

Status: **OWNER-APPROVED PRIMARY INTERACTION — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

`../The-Core-Lattice-Philosophy.md` remains unchanged and highest Product authority. This interaction contract is subordinate to the Core and current Owner decision OD-011.

This contract preserves the approved continuous Conversation + free-form ConversationInput + adaptive Composer interaction while reconciling Solandra's current role from presentation-only to genuine cognition.

`../Lattice-Intent-and-Decision-Architecture.md` and the Knowledge/action architectures control the meaning of governed state.

## 1. Core concept

Imagine Solandra standing with the person, talking naturally while using a shared screen beside her.

Solandra is the intelligent expert in that interaction. She may understand, clarify, investigate, reason, compare, recommend, coordinate capabilities, prepare action, and explain.

The shared screen is the **Composer**.

The primary frame remains:

1. **Conversation** — the interpersonal exchange.
2. **ConversationInput** — free-form text entry/send.
3. **Composer** — the dominant visual information surface for what is most useful now.

## 2. Continuous interaction

Ordinary interaction is one continuous conversation, not a fixed user-facing workflow or presentation-stage sequence.

Solandra may move naturally among:

- interpretation;
- clarification;
- Knowledge gathering;
- explanation;
- comparison;
- Recommendation;
- USER choice when relevant;
- correction;
- evidence/source inspection;
- Resource use;
- ActionProposal preparation;
- authorization discussion;
- execution/recovery/verification follow-up.

The person should not have to learn stage names or hidden trigger phrases to make Solandra useful.

## 3. Cognition and trust

Solandra may think ahead and decide what work is useful. Material state is still constrained by Lattice trust boundaries:

- Solandra interpretation/hypothesis is not automatically canonical USER Intent;
- Lattice Intent Integrity establishes what meaning may be relied upon;
- raw information/model/provider output is not automatically Knowledge;
- Lattice Knowledge Trust/V36 establishes governed factual support;
- Solandra produces ordinary advisory Recommendation over governed Intent + Knowledge;
- an optional formal Decision Engine capability may contribute when formal guarantees are useful;
- Recommendation is not the person's accepted Decision/Choice;
- when exact USER choice materially matters downstream, Intent Integrity may preserve an optional `AcceptedChoice`;
- accepted USER Decision/Choice is not Authorization;
- Recommendation is not Authorization;
- consequential ActionProposal execution requires the applicable Authorization;
- Authorization is not Execution;
- Execution is not Verification; and
- ExecutionReceipt is not Verification.

The UI may feel fluid without hiding a material trust distinction when the distinction affects what the person can safely rely on or do.

## 4. Material clarification

Solandra should proceed on ordinary reasonable interpretation when meaning is materially sufficient.

Ask/confirm when unresolved meaning could materially change:

- what Knowledge is needed;
- truth/research scope;
- Recommendation or formal decision outcome;
- the person's materially consequential choice;
- target/arguments of a consequential action;
- authorization scope.

Do not turn confirmation into ceremony. A generic `yes` only confirms the exact fresh proposition it unambiguously answers.

## 5. Composer law

At every point ask:

> **What is the most useful trustworthy thing for this person to see right now?**

Composer content may include:

- accepted Intent/understanding;
- a clearly tentative interpretation;
- governed Knowledge/findings;
- material uncertainty/limitations;
- comparison or Recommendation;
- accepted USER choice when seeing it is useful;
- optional formal decision result/frontier;
- warning/plan;
- Resource;
- source/evidence inspection;
- ActionProposal/authorization summary;
- execution/verification state;
- recovery information.

These are content patterns, not fixed phases.

Prefer useful information over narration of provider, worker, Run, queue, task, model-route, or orchestration machinery.

## 6. No-riddle behavior

Useful Product capability must not depend on discovering commands such as:

- `compare`;
- `research`;
- `recommend`;
- `continue`;
- `what next`;
- `show sources`.

Those are valid requests, but Solandra should proactively use/surface relevant capabilities when licensed and useful.

## 7. Governed referential continuity

ConversationReference binds meaningful turns to exact governed objects.

Natural follow-ups should resolve against those refs:

- “Explain that.” -> the exact referenced Knowledge/Recommendation.
- “What were your sources?” -> actual historical Knowledge -> Evidence -> Source provenance.
- “What about the second option?” -> the referenced alternative/basis.
- “I’ll take the second one.” -> the referenced alternative may become an `AcceptedChoice` through Intent Integrity when exact choice matters downstream.
- “Do it.” -> the exact ActionProposal if current, or a newly prepared proposal from the referenced Recommendation/AcceptedChoice.
- “Did it work?” -> the exact ExecutionReceipt/Verification state.

Do not re-search merely to invent provenance for an old answer. Do not treat pronoun/reference resolution, Recommendation, or USER choice as action Authorization.

## 8. Recommendation shape

Ordinary Recommendation is Solandra advisory state and may be one recommendation, alternatives, a conditional answer, or no responsible recommendation.

The person's actual choice remains distinct from the Recommendation. Presentation must not imply that Solandra's preferred option was selected by the USER merely because it was recommended or visually emphasized.

When a formal Decision Engine capability is used, preserve its qualified shape. A formal frontier/tie must not become a fabricated winner through presentation convenience.

The UI does not require formal Decision Engine participation for ordinary advice or ordinary USER choice.

## 9. Resources and action

A useful Resource may take over Composer while Conversation and ConversationInput remain available. One quiet return action restores the prior composition.

Prepared assistance and USER choice remain separate from authorization and execution:

```text
Recommendation
  -> optional accepted USER Decision/Choice
  -> ActionProposal
  -> Authorization
  -> Execution
  -> ExecutionReceipt
  -> Verification
```

Not every action requires a prior Recommendation or durable `AcceptedChoice`; those states remain distinct whenever they exist.

Solandra may ask naturally for missing Authorization. Do not expose an authorization wizard unless a concrete Product need requires it.

## 10. Change and reversibility

When the person corrects or changes meaning:

- Intent Integrity establishes successor Intent state;
- Solandra recomputes only dependent cognition/output;
- stale Knowledge/Recommendation/AcceptedChoice/ActionProposal presentation is retired where its basis is no longer valid;
- historical governed state remains inspectable rather than rewritten.

A follow-up question that does not change Intent may simply be answered through existing references.

## 11. Primary anti-drift invariants

A UI/interaction change is non-conforming if it:

1. reduces Solandra to presentation-only behavior;
2. turns ConversationInput into a workflow controller;
3. introduces a fixed user-facing stage taxonomy/global readiness gate;
4. requires hidden commands to unlock capability;
5. presents Solandra interpretation as canonical Intent without the applicable trust basis;
6. presents raw information as governed Knowledge;
7. requires formal Decision Engine state for every Recommendation or USER choice;
8. converts Recommendation into accepted USER Decision/Choice;
9. converts accepted USER Decision/Choice into Authorization;
10. converts Recommendation or ActionProposal into Authorization;
11. collapses Authorization into Execution;
12. converts Execution or ExecutionReceipt into Verification;
13. reconstructs old authority/provenance from prose when exact governed refs exist;
14. exposes internal provider/worker/Run machinery instead of useful state;
15. fabricates a formal winner/frontier collapse;
16. makes mobile/zoom/accessibility materially less usable.
