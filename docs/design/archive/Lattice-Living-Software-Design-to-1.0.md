# Lattice Living Software Design to 1.0

Version: **0.11 — Solandra cognition / Lattice trust reconciliation**

Status: **CURRENT OWNER-DIRECTED FORWARD PRODUCT DIRECTION**

Reconciled: **2026-09-08**

Repository design baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This living design is subordinate to the Core and current Owner decision OD-011.

This document records forward Product direction. Detailed stable semantics live in the dedicated architecture documents. Historical amendments/decision records remain provenance.

## 1. Authority

1. `The-Core-Lattice-Philosophy.md` — highest Product authority.
2. `Lattice-Owner-Decision-OD-011-Solandra-Cognition-Lattice-Trust-Reconciliation.md` — current architecture reconciliation.
3. Other applicable Owner decisions where not superseded/narrowed by OD-011.
4. Dedicated permanent architecture documents for their qualified domains.
5. Fresh canonical source for current implementation facts.

## 2. 1.0 Product direction

Lattice 1.0 is a trustworthy conversational Product in which:

- the person talks naturally with Solandra;
- Solandra understands, reasons, plans, investigates, recommends, coordinates capabilities, and explains;
- Lattice preserves intent integrity and turns information into governed Knowledge;
- Solandra can make useful ordinary Recommendations without forcing every problem through a formal Decision Engine;
- formal deterministic decision/optimization capabilities are available when they genuinely help;
- conversation follow-ups resolve against durable governed objects rather than prose reconstruction;
- useful Resources and ActionProposals reduce friction;
- consequential actions require the applicable narrow Authorization;
- execution remains durable/recoverable; and
- completion is represented as verified only when the intended resulting state is actually verified.

Trustworthy Knowledge remains a complete Product outcome. A consultation does not need a Recommendation or action to be complete.

## 3. Target logical architecture

```text
USER
  <-> Solandra Cognitive Runtime
          |
          +--> Lattice Intent Integrity
          |
          +--> Lattice Knowledge Trust
          |       Source -> Evidence -> Claim -> Knowledge
          |
          +--> Capability Broker
          |       +--> user-authorized model
          |       +--> research/source capabilities
          |       +--> calculation/code/tools
          |       +--> optional formal Decision Engine
          |
          +--> Recommendation
          |
          +--> Resource / ActionProposal
                    |
                    v
             Lattice Action Trust
             Authorization
                    |
                    v
                Execution
                    |
                    v
             ExecutionReceipt
                    |
                    v
               Verification
```

ConversationReference links meaningful turns to the exact governed objects consumed/produced by those turns.

## 4. Solandra Cognitive Runtime

Solandra maintains a semantic working representation of the conversation, including as useful:

- probable objective;
- relevant context;
- constraints/preferences;
- entities/referents;
- material ambiguity;
- current task type;
- likely useful next work; and
- relevant governed object references.

Solandra may propose intent, Knowledge requests, investigation plans, hypotheses, comparisons, Recommendations, ActionProposals, capability calls, and explanations.

Cognitive state is not automatically trust state. Material outputs cross the owning Lattice boundary before they are treated as established.

## 5. Intent Integrity

Intent Integrity answers: **what USER meaning is Lattice justified in relying on?**

1. Persist exact USER provenance where material.
2. Let Solandra interpret ordinary language.
3. Accept materially clear USER-supported meaning without confirmation ceremony.
4. Clarify/confirm only when unresolved meaning could materially change truth, Recommendation/formal decision, or consequential action.
5. Preserve correction/supersession lineage.
6. Keep transcript/context distinct from canonical established Intent.

Existing IntentVersion/provenance machinery may be evolved rather than replaced.

## 6. Knowledge Trust

The central epistemic contract is:

```text
KnowledgeRequest
  -> acquire information
  -> identify Claims
  -> attach Source/Evidence provenance
  -> evaluate support/conflict/currency
  -> preserve uncertainty/unresolved limits
  -> Knowledge
```

Existing V36 Truth Core is protected and should be reused where it supplies these guarantees. The target is not to weaken V36; it is to make governed Knowledge a first-class durable Product object that Solandra can reason over and reference later.

Knowledge must support “What were your sources?” by traversing the actual provenance used for the prior answer, not by re-searching and retroactively attaching new sources.

## 7. Recommendation

General Recommendation is advisory Solandra Product state over the exact governed basis:

```text
Intent + Knowledge + preferences/constraints + known uncertainty
  -> Solandra reasoning
  -> Recommendation
```

Recommendation should retain enough basis/provenance to explain assumptions, important evidence, uncertainty, alternatives, and why the advice follows.

Recommendation is not Authorization.

## 8. Optional formal decision capability

The existing Decision Engine remains useful as a qualified capability for problems that materially benefit from typed constraints, criterion semantics, optimization, material-dominance/frontier analysis, statistics, or other formal guarantees.

It is not required for ordinary Recommendation.

If used, its formal result remains a governed input to Solandra and must preserve its exact qualified semantics. Solandra must not turn a formal frontier/tie into a fabricated winner.

## 9. Capability Broker and user-authorized model

Solandra should request capabilities by what they accomplish, not by provider plumbing.

A capability exposes the equivalent of:

```text
id
description
input contract
output contract
permissions required
side effects
verification method
```

Existing Execution Runtime/Model Gateway/research adapters may implement the broker underneath.

The user's selected model is one capability. Solandra's own cognitive runtime role remains logically distinct from user-authorized-model assistance even if one foundation model initially supplies both roles.

## 10. ConversationReference and continuity

Meaningful turns retain durable references to governed objects, for example:

```text
Turn 42
  intent: I12
  knowledge: K109, K114
  recommendation: R7
  actionProposal: AP3?
```

This supports natural follow-ups:

- “Explain that.”
- “What were your sources?”
- “What about the second option?”
- “Do it.”

Reference resolution may identify the intended governed object; it never itself grants new truth or action authority.

## 11. Resource and action path

Resources remain useful application objects that help a person understand or act.

The consequential chain is:

```text
Recommendation
  -> ActionProposal
  -> Authorization
  -> Execution
  -> ExecutionReceipt
  -> Verification
```

Preparation does not execute. Authorization binds the exact proposal where required. ExecutionReceipt records what the executor reports. Verification records what Lattice can establish about resulting reality.

## 12. Durable state target

At minimum, the architecture must be able to persist or reconstruct exact durable forms of:

- Conversation and USER provenance;
- Intent;
- Source;
- Evidence;
- Claim;
- Knowledge;
- Recommendation;
- ActionProposal;
- Authorization;
- ExecutionReceipt;
- Verification;
- ConversationReference;
- operational execution/recovery state required to safely continue work.

Do not use generated prose, telemetry, or presentation state as a second authority.

## 13. Reliability, privacy, and ownership

Preserve existing strengths:

- authenticated subject isolation;
- deletion/retention boundary;
- immutable historical intent/evidence where required;
- idempotency and duplicate suppression;
- stale-result rejection;
- bounded retry/cancellation;
- ambiguous non-idempotent/consequential completion protection;
- minimum-necessary provider/tool context;
- secret isolation;
- provider/model non-authority.

Reliability should remain mostly invisible when it can recover without changing Product meaning.

## 14. Primary UX

The primary experience remains:

1. **Conversation**
2. **free-form ConversationInput**
3. **adaptive Composer**

No fixed presentation-stage workflow, no-riddle commands, provider/task dashboards, or universal formal-decision UI.

Solandra may surface Knowledge, Recommendations, alternatives, uncertainty, Resources, ActionProposals, execution state, or Verification when useful and licensed.

## 15. Current implementation versus target

At the reconciliation base, current source already provides valuable foundations:

- durable Run/recovery mechanisms;
- IntentVersion provenance/correction foundations;
- protected V36 truth/evidence machinery;
- provider-neutral Model Gateway;
- formal Decision Engine capability;
- Conversation + Composer UI direction;
- Resource/action-preparation foundations;
- subject isolation/continuity foundations.

Current code still reflects predecessor allocation in material places, especially presentation-only Solandra and formal decision-centric composition. **This design reconciliation does not claim that code already implements OD-011.**

## 16. Near-term implementation priority

After this design candidate is independently reviewed, bounded implementation should prioritize in this order unless later Owner direction changes it:

1. **Solandra cognitive runtime boundary** — ordinary semantic understanding/reasoning with explicit proposal-vs-trust separation.
2. **Intent Integrity adaptation** — preserve provenance/correction while removing ritualized universal interpretation ownership.
3. **Durable Knowledge** — first-class Source/Evidence/Claim/Knowledge graph over protected V36 semantics.
4. **ConversationReference** — exact turn-to-governed-object binding and referential follow-up resolution.
5. **Capability Broker** — capability-first interface over existing execution/model/research mechanisms.
6. **General Recommendation** — advisory Solandra reasoning over governed Intent + Knowledge; formal engine optional.
7. **Action trust completion** — durable ActionProposal, Authorization, ExecutionReceipt, and Verification contracts.
8. **Provider/production promotion** — qualify live routes and operations only after the Product boundaries they serve are mechanically established.

Prefer vertical slices that prove useful behavior through the ordinary Conversation path.

## 17. Open decisions retained

Unless separately resolved by the Owner, prior open decisions remain open, including provider/routing policy, production topology, SLO/budget targets, and general file-ingestion scope. OD-011 does not silently settle them.

## 18. 1.0 acceptance direction

An exact 1.0 candidate must demonstrate, at minimum:

- natural ordinary-language Solandra cognition without presentation-only restriction;
- materially correct Intent Integrity behavior and correction lineage;
- governed durable Knowledge with inspectable provenance/uncertainty;
- source follow-up from the actual historical Knowledge basis;
- ordinary Recommendation without mandatory formal Decision Engine participation;
- optional formal capability fidelity where invoked;
- ConversationReference continuity across reconnect/restart;
- capability calls bounded by subject, permissions, side effects, budgets, and provenance;
- Recommendation distinct from ActionProposal/Authorization;
- exact consequential Authorization before applicable execution;
- restart/idempotency/ambiguity safety;
- ExecutionReceipt distinct from Verification;
- verified-completion claims supported by actual verification evidence;
- subject isolation/privacy/deletion behavior;
- continuous Conversation + Composer usability and accessibility.

Documentation review cannot satisfy these runtime gates.

## 19. Change log

| Version | Date | Baseline | Change |
| --- | --- | --- | --- |
| 0.11 | 2026-09-08 | `e35f57e0621b81a66285c729b124d0c87ce8dffa` / `e7eb933e228735e3cefe472bc0d4269c71b556fa` | Reconciles current forward direction to OD-011: Solandra cognition, Lattice trust, durable Knowledge/ConversationReference, general advisory Recommendation, optional formal Decision Engine capability, capability-first execution, and explicit Authorization/ExecutionReceipt/Verification chain. |

Earlier versions and amendments remain repository provenance and should be read as historical design at their stated baselines where they conflict with OD-011.
