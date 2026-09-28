# Lattice System Architecture

Status: **CURRENT IMPLEMENTATION MAP + OWNER-DIRECTED TARGET COMPOSITION**

Reconciled: **2026-09-08**

Fresh observed implementation baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This structural map is subordinate to the Core and current Owner decision OD-011.

## 1. Purpose

This document separates two things that must not be confused:

1. **what current source at the baseline structurally does**; and
2. **the current Product target established by OD-011**.

The design reconciliation changes no runtime code. Current implementation facts remain facts until later implementation work changes them.

## 2. Current Product target

```text
USER
  <-> Solandra Cognitive Runtime
          |
          +--> Lattice Intent Integrity
          +--> Lattice Knowledge Trust
          +--> Capability Broker
          |       +--> Model Gateway / user-authorized model
          |       +--> research/source/tool capabilities
          |       +--> optional formal Decision Engine
          |
          +--> Recommendation
          +--> Resource / ActionProposal
                    |
                    v
               Authorization
                    |
                    v
                 Executor
                    |
                    v
             ExecutionReceipt
                    |
                    v
               Verification
```

ConversationReference binds later turns to the exact governed objects used or produced earlier.

The target is logical. The preferred physical architecture remains one modular codebase with process separation only where reliability/operations justify it.

## 3. Observed current implementation at the baseline

Current source already contains important predecessor-architecture foundations:

- `src/intent/*` — canonical intent/provenance/version/correction mechanisms;
- `src/truth/*` — protected V36 evidence/truth contracts and execution pipeline;
- `src/run-*`, `src/runtime-*`, orchestration stores/workers — durable execution/recovery mechanisms;
- `src/model/*` — provider-neutral model boundary/runtime/adapters;
- `src/decision/*` and `src/engine.ts` — formal typed decision machinery;
- `src/presentation/solandra/*` — current Solandra presentation/read-model composition;
- Conversation/auth/continuity stores and APIs — subject-owned interaction continuity;
- Resource/action-preparation surfaces — current Resource and ActionPreparation foundations.

At the baseline, these pieces are still composed substantially according to the predecessor model in which Solandra is presentation-focused and decision work is routed through formal machinery when qualified. OD-011 changes forward design, not this observed code fact.

## 4. Migration interpretation of existing components

### `src/intent/*`

Reuse as the foundation for **Lattice Intent Integrity**:

- USER provenance;
- immutable/versioned accepted meaning;
- material clarification/confirmation;
- correction/supersession lineage;
- exact downstream binding.

Do not require this layer to remain the universal ordinary-language cognitive engine.

### `src/truth/*` / V36

Reuse as protected **Knowledge Trust** machinery.

V36 remains responsible for evidence/provenance/truth admission semantics. Later work may wrap or extend it with first-class Source/Evidence/Claim/Knowledge objects; the design does not license weakening V36 to make the model path easier.

### Runtime/orchestration

Reuse for durable execution safety:

- exact work identity;
- CAS/stale rejection;
- worker/task recovery;
- retry/idempotency;
- cancellation;
- durable continuation;
- operational provenance.

Runs and workers remain implementation mechanics rather than the cognitive ontology presented to Solandra/users.

### `src/model/*`

Reuse as capability mechanism/provider-neutral Model Gateway.

The model boundary does not itself define Solandra cognition or USER-authorized-model authority. Later work should keep those logical contexts/permissions distinct even if the same provider/model serves both.

### Formal decision code

Reuse as an optional qualified capability when a problem needs its typed guarantees.

Do not place it on every ordinary Recommendation path.

### `src/presentation/solandra/*`

Reuse the continuous Conversation + Composer UX and presentation foundations, but future implementation must expand Solandra from presentation read-model behavior into the cognitive runtime role defined by OD-011.

### Resource/action code

Reuse preparation, Resource, provenance, subject-bound access, and stale-view foundations while completing the explicit `ActionProposal -> Authorization -> ExecutionReceipt -> Verification` trust graph.

## 5. Target semantic objects

Target durable Product concepts:

```text
Conversation
USER Message / provenance
Intent
Source
Evidence
Claim
Knowledge
Recommendation
Resource
ActionProposal
Authorization
ExecutionReceipt
Verification
ConversationReference
```

Operational objects may remain:

```text
Run
Task
Attempt
Lease
Dispatch
Checkpoint
Provider Request/Response
Capability Result
```

Operational objects support durability/reliability. They do not replace semantic/trust objects.

## 6. Target cognition/trust flow

### Knowledge request

```text
Conversation
 -> Solandra interprets need
 -> Intent Integrity establishes materially sufficient Intent
 -> Solandra identifies Knowledge need
 -> capability acquisition/research
 -> Knowledge Trust evaluates Source/Evidence/Claim
 -> Knowledge
 -> Solandra explains or continues reasoning
```

No DecisionPlan/Decision Engine is required merely to answer a Knowledge need.

### Ordinary advice

```text
Intent + Knowledge
 -> Solandra reasoning
 -> Recommendation
 -> ConversationReference
 -> Conversation / Composer
```

The Recommendation records its governed basis and uncertainty. It is advisory.

### Formal comparison when justified

```text
Intent + Knowledge
 -> Solandra determines formal capability is useful
 -> qualified formal input/binding
 -> Lattice Decision Engine
 -> formal result
 -> Solandra reasons/explains faithfully
 -> Recommendation and/or comparison Resource
```

The formal result does not become the universal Product architecture.

### Consequential action

```text
Recommendation/reference
 -> Solandra prepares exact ActionProposal
 -> Lattice Authorization boundary
 -> Execution Runtime / executor
 -> ExecutionReceipt
 -> independent Verification where possible
 -> Solandra reports verified or explicitly unverified outcome
```

## 7. ConversationReference

ConversationReference is the bridge between natural conversational pronouns and governed state.

A reference may bind one turn to one or more exact objects, for example:

```text
turnId
intentRefs[]
knowledgeRefs[]
recommendationRefs[]
actionProposalRefs[]
authorizationRefs[]
executionReceiptRefs[]
verificationRefs[]
```

Exact schema is future implementation work. The invariant is that “that”, “the second one”, “your sources”, and “do it” resolve against actual prior governed objects rather than reconstructed prose authority.

## 8. Authority boundaries

| Concept | Current target owner | Non-authoritative helpers |
| --- | --- | --- |
| Ordinary semantic understanding | Solandra | provider/model/parser mechanism |
| Established USER intent | Lattice Intent Integrity | Solandra interpretation proposal |
| Source/evidence/claim admission | Lattice Knowledge Trust / protected V36 | retriever, model, provider, worker |
| Ordinary advisory Recommendation | Solandra over governed basis | model/user-model capability, optional algorithms |
| Formal typed decision result | qualified Lattice Decision Engine invocation | Solandra orchestrates/consumes it |
| Capability execution safety | Lattice Execution Runtime/policy | worker/provider/tool |
| Consequential authorization | Lattice Action Trust | Solandra may ask naturally |
| External execution | qualified executor | Authorization licenses it; executor does not self-authorize |
| Verified resulting state | Lattice Verification boundary | ExecutionReceipt/provider report is evidence, not verification by itself |
| Human-facing interaction | Solandra Conversation + Composer | browser/client rendering |

## 9. Persistence and restart

Restart reconstructs trust state from durable governed objects and exact operational continuation state. It must not regenerate canonical Intent, Knowledge, Recommendation, Authorization, or Verification from explanation prose when those objects exist.

Derived presentation may be recomposed. Missing governed state required for a promised continuation is a durability gap, not a cache miss.

## 10. Implementation sequencing constraint

Later implementation should evolve this architecture incrementally:

1. cognition boundary;
2. Intent Integrity adaptation;
3. durable Knowledge;
4. ConversationReference;
5. capability-first interface;
6. ordinary Recommendation;
7. action authorization/verification completion.

Avoid a rewrite of sound runtime/V36/continuity machinery merely to rename the architecture.

## 11. No runtime claim

This document records target composition and the observed baseline mapping. It does not claim that `e35f57e...` already implements the target cognition, Knowledge, Recommendation, ConversationReference, Authorization, ExecutionReceipt, or Verification contracts.
