# Lattice Architecture Integrity

Status: **OWNER-APPROVED CROSS-CUTTING ARCHITECTURE CONTROL — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Repository baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This document is subordinate to the Core and to current Owner decision OD-011 where OD-011 supersedes older topology.

## 1. Purpose

Architecture Integrity protects the Product distinctions that make Lattice trustworthy. It does **not** freeze a historical component topology.

## 2. Primary integrity law

The current architecture is logically:

```text
Solandra cognition
      |
      +--> Lattice intent integrity
      +--> Lattice Knowledge trust
      +--> bounded capabilities
      +--> optional formal decision capability
      +--> action authorization / execution / verification
```

Solandra may understand, reason, plan, investigate, recommend, coordinate capabilities, and explain. Those cognitive acts remain proposals or advisory state until the applicable Lattice trust boundary establishes what may be treated as authoritative.

## 3. Protected distinctions

The following distinctions are architectural invariants:

1. `conversation != canonical intent`
2. `interpretation != USER authority`
3. `model confidence != USER provenance`
4. `information != Knowledge/truth`
5. `retrieval success != evidence admission`
6. `provider/model output != Product truth`
7. `Knowledge/truth != Recommendation`
8. `Recommendation != accepted USER Decision/Choice`
9. `accepted USER Decision/Choice != Authorization`
10. `formal decision result != universal recommendation architecture`
11. `Recommendation != ActionProposal`
12. `ActionProposal != Authorization`
13. `Authorization != Execution`
14. `Execution != Verification`
15. `ExecutionReceipt != Verification`
16. `presentation != authority`
17. `capability != authority`
18. `persistence != authority transfer`
19. `retry/recovery != semantic promotion`

A design or implementation may reorganize components while preserving these boundaries.

## 4. Solandra cognition boundary

Solandra owns the Product's ordinary cognitive work:

- semantic interpretation of conversation;
- reference resolution;
- hypothesis formation about intent and useful next work;
- clarification strategy;
- investigation planning;
- reasoning over governed Knowledge;
- advisory comparison and Recommendation;
- capability coordination; and
- natural explanation/presentation.

Solandra must not silently:

- convert its interpretation into unsupported canonical USER intent;
- present ungoverned information as established Knowledge;
- strengthen evidence or erase material uncertainty;
- convert a Recommendation into a USER Decision/Choice;
- convert a Recommendation or USER Decision/Choice into authorization;
- execute a consequential action without the applicable authorization boundary; or
- report verified completion from an execution receipt alone.

## 5. Intent Integrity boundary

Lattice Intent Integrity owns what the Product is justified in treating as established USER intent.

It preserves:

- exact USER provenance;
- immutable/versioned correction lineage;
- materiality-sensitive clarification/confirmation;
- separation of transcript/context from canonical intent; and
- exact basis binding where downstream trust depends on it.

When a person's actual decision or choice materially matters downstream, Intent Integrity may also preserve an exact accepted `AcceptedChoice` as governed USER state. That is not a new authority subsystem. It is the minimum durable distinction needed to keep Solandra's Recommendation separate from what the person actually chose, and to keep that choice separate from any later Authorization.

It is a trust guard, not a requirement that ordinary language understanding be deterministic or ritualized.

## 6. Knowledge Integrity boundary

Lattice Knowledge Trust owns the transition from information to governed Knowledge.

The protected graph is conceptually:

```text
Source -> Evidence -> Claim -> Knowledge
```

Material Knowledge retains provenance, currency, conflict, uncertainty, and unresolved limits. Existing V36 Truth Core contracts remain protected implementation/trust machinery where applicable.

Operational success, source count, repeated model agreement, provider reputation, or fluent prose may not bypass this boundary.

## 7. Recommendation, USER choice, and optional formal decision boundary

General advisory Recommendation is Solandra cognitive Product state grounded in current governed Intent and Knowledge.

A person may accept, reject, or choose among recommendations conversationally. When that choice matters to later Product state, the accepted choice is governed USER state owned by Intent Integrity. It is not inferred from Solandra's preference, visual emphasis, or a formal result, and it is not execution Authorization.

The formal Lattice Decision Engine is optional. It may be invoked as a qualified capability when typed constraints, criterion semantics, optimization, frontier/tie analysis, or other formal guarantees materially help.

When used, its exact formal result remains attributable to its qualified inputs and must be represented faithfully. Formal machinery must not be required merely because a user asks for ordinary advice or makes an ordinary choice.

## 8. Capability boundary

Models, providers, algorithms, retrieval systems, tools, workers, queues, and external APIs are capabilities or execution mechanisms.

They may perform bounded work. They do not acquire USER, truth, recommendation, authorization, or verification authority by availability or success.

Capability before provider remains the design preference.

## 9. Action integrity boundary

Consequential behavior preserves these distinctions:

```text
Recommendation
   -> optional accepted USER Decision/Choice
   -> optional ActionProposal
   -> Authorization
   -> Execution
   -> ExecutionReceipt
   -> Verification
```

Not every action is preceded by a Recommendation or explicit durable choice, but whenever those states exist they remain distinct. Each arrow is an explicit boundary. A prior stage cannot be treated as proof of a later one.

Authorization is narrow and action-specific where required. Ambiguous consequential completion fails closed. Verification should use independent observation when available; where verification cannot be established, the Product says so.

## 10. State and recovery integrity

Durability must preserve meaning rather than reconstruct it from prose or telemetry.

Current target governed objects include:

- Intent;
- Source;
- Evidence;
- Claim;
- Knowledge;
- Recommendation;
- AcceptedChoice when an exact USER decision/choice materially matters downstream;
- ActionProposal;
- Authorization;
- ExecutionReceipt;
- Verification; and
- ConversationReference.

Operational Runs, tasks, attempts, leases, checkpoints, queues, provider requests, and the act of Execution may remain durable implementation/operational state, but they do not replace those semantic/trust objects.

Stale authoritative writes are rejected. Stale derived state is recomputed or discarded. Retry, restart, and reconnect do not transfer authority.

## 11. Privacy and ownership integrity

Authenticated subject isolation, Conversation ownership, deletion/retention boundaries, secret handling, and minimum-necessary capability context remain protected.

ConversationReference and Knowledge provenance must not become shortcuts around subject ownership or deletion.

## 12. Anti-drift review

A change is non-conforming if it:

- forces Solandra back into presentation-only behavior without current Owner authority;
- requires formal Decision Engine participation for ordinary Recommendation by default;
- lets Solandra/model output bypass Intent Integrity or Knowledge Trust;
- treats internal workflow topology as Product cognition;
- exposes providers/workers/queues/Runs to users when they are not materially useful trust state;
- conflates Recommendation, accepted USER Decision/Choice, Authorization, Execution, ExecutionReceipt, or Verification;
- weakens V36/evidence/provenance safeguards for convenience;
- turns persistence or telemetry into a second authority; or
- adds a major subsystem without demonstrated Product value for this one-owner project.

## 13. Acceptance evidence

Architecture Integrity review should establish, for an exact candidate:

- current design documents consistently allow Solandra cognition;
- no current normative document requires the formal Decision Engine for ordinary Recommendation;
- intent integrity and semantic understanding are distinct;
- durable Knowledge and ConversationReference are explicit target concepts;
- Recommendation, accepted USER Decision/Choice, Authorization, Execution, and Verification remain distinct where applicable;
- provider/model non-authority remains explicit; and
- no runtime behavior is claimed from documentation changes alone.
