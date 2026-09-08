# Lattice Execution and Capability Architecture

Status: **OWNER-DIRECTED CROSS-SYSTEM EXECUTION ARCHITECTURE — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Repository design baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This document is subordinate to the Core and current Owner decision OD-011.

## 1. Purpose

Lattice must let Solandra use models, sources, algorithms, and tools without making provider/worker mechanics the Product's cognitive architecture or allowing capability success to become semantic authority.

The stable rule remains:

> **Execution determines how bounded licensed work proceeds and recovers. It does not determine what the result means, whether it was authorized, or whether the resulting external state is verified.**

## 2. Capability-first upward interface

Solandra should request work by capability:

```text
Solandra cognitive need
 -> capability request
 -> Product-owned capability/policy boundary
 -> Lattice Execution Runtime
 -> executor/provider/tool
 -> operational result + provenance
 -> owning trust/cognitive consumer
```

The user should not have to manage provider, worker, Run, queue, route, lease, retry, or checkpoint machinery.

## 3. Capability contract

A capability is a Product-defined bounded operation. It should expose the equivalent of:

```text
id
description
input contract
output contract
permissions required
side effects
verification method
```

Useful additional execution metadata includes:

- capability version;
- subject/Conversation/Intent binding where needed;
- call/time/input/output budgets;
- privacy/egress constraints;
- idempotency class;
- consequence/reversibility classification;
- result/provenance contract.

A provider/model/tool is one implementation of a capability, not the capability's authority.

## 4. Capability Broker

`Capability Broker` is the logical catalog/request interface Solandra uses. It need not be a separate service.

Existing Execution Runtime, Model Gateway, research adapters, local functions, and formal algorithms may implement capabilities underneath the interface.

The broker must not become a new semantic authority or orchestration stack.

## 5. Execution Runtime ownership

Execution Runtime retains durable operational responsibility for:

- exact logical operation/work identity;
- active subject/Conversation/basis checks;
- capability license/policy checks;
- schema validation;
- budgets;
- privacy/egress limits;
- dispatch;
- worker/task leases;
- timeout/cancellation;
- retries/backoff;
- idempotent replay;
- ambiguous-completion protection;
- stale-result rejection;
- accepted operational result persistence;
- restart recovery;
- operational provenance.

Runtime does not own ordinary cognition, established USER intent, Knowledge/truth, Recommendation, consequential Authorization, or Verification.

## 6. Current `Run` and grant machinery

Existing `Run`, `CapabilityGrant`, task, lease, attempt, and outbox semantics remain useful implementation mechanisms.

They may continue to bind exact:

```text
Run
subject
IntentVersion / current trusted basis
capability role/ID/version
operation identity
```

OD-011 does not require exposing these objects as Solandra's cognitive model. Future implementation may add a cleaner capability-facing abstraction while reusing the same durable mechanisms underneath.

## 7. Models and user-authorized model

Lattice Model Gateway remains a provider-neutral capability mechanism.

Two logical model roles must remain distinguishable:

1. **Solandra cognition** — the model/context used to implement Solandra's own cognitive runtime;
2. **user-authorized model capability** — a model the USER permits Solandra to call for bounded assistance.

The same foundation model may initially serve both only if context, permissions, data projection, provenance, and authority contracts remain logically separate.

Model/tool output is always proposal or operational material until the applicable Product boundary accepts it.

## 8. Tool proposals are not authority

```text
model/Solandra proposes capability call
 -> exact capability exists?
 -> input schema valid?
 -> subject/basis active?
 -> permissions/side-effect policy satisfied?
 -> budgets/egress valid?
 -> required action Authorization satisfied?
 -> execute
```

No model receives generalized shell/filesystem/database/network/repository/production/credential authority merely because broad assistance is useful.

## 9. Information and Knowledge admission

Factual/research-bearing operational output routes to Lattice Knowledge Trust/V36 before Solandra treats it as established Knowledge.

```text
capability result
 -> information/provenance
 -> Knowledge Trust / V36
 -> admit / reject / conflict / unresolved / more research
 -> Knowledge
```

Operational success, provider confidence, repetition, or structure cannot bypass this boundary.

## 10. Optional formal Decision Engine capability

The existing Decision Engine may be registered as a qualified capability with explicit input/output semantics.

Execution Runtime may schedule/execute it like other bounded work, but the formal result retains its qualified semantics and remains optional. The existence of a formal executor does not force every Recommendation through it.

## 11. Side effects and consequence

Execution classification remains multi-axis. At minimum preserve distinctions equivalent to:

```text
Effect: OBSERVE | EXTERNAL_PROCESSING | MUTATE
Consequence: ROUTINE | CONSEQUENTIAL
Reversibility: REVERSIBLE | IRREVERSIBLE | UNKNOWN
Idempotency: IDEMPOTENT | NON_IDEMPOTENT
```

These are independent properties.

Idempotent does not mean consequence-free. Reversible does not mean non-consequential.

## 12. Action authorization boundary

A capability license/CapabilityGrant is never sufficient by itself to execute a consequential action.

For applicable consequential action:

```text
ActionProposal
 -> exact Authorization
 -> Runtime final policy/binding check
 -> executor
```

USER semantic confirmation, a Recommendation, a USER choice, model tool proposal, capability availability, or a prior authorization for another proposal cannot substitute for exact action Authorization.

## 13. Operation identity, retry, and ambiguity

Logical operation identity is distinct from attempt/worker/provider request identity.

- duplicate delivery should reuse accepted work where safe;
- retry keeps the same material semantic operation unless input meaning changes;
- retry does not reset budgets;
- stale/changed binding blocks current-result release;
- non-idempotent ambiguous completion does not blindly redispatch;
- provider fallback is valid only when the qualified capability contract permits equivalent substitution and actual route provenance remains explicit.

## 14. Cancellation

Cancellation is durable operational state. Best-effort abort does not prove the external operation did not occur.

Late results after cancellation, deletion, subject invalidation, or superseded basis cannot become current Product output.

## 15. ExecutionReceipt

Every material executed action should produce a durable normalized `ExecutionReceipt` or equivalent operational record sufficient for recovery/audit.

It records what the executor/runtime observed/reported. It does not itself establish that the intended external state is now true.

## 16. Verification handoff

Where an action outcome matters, the capability contract should identify how resulting state can be verified.

After execution:

```text
ExecutionReceipt
 -> independent observation/status capability where possible
 -> Verification
```

If no qualified verification mechanism exists, Solandra must communicate the limitation rather than promote execution success to verified completion.

## 17. Context minimization and secrets

Capability execution receives only minimum-necessary context. A capability request does not authorize export of full Conversation history, unrelated preferences, prior external facts, secrets, or generalized memory.

Secrets remain operational configuration and must not become Intent, Knowledge, Recommendation, Conversation, or model-visible state unless the exact capability boundary requires controlled use.

## 18. Reliability and recovery

Reuse existing durable orchestration instead of adding an agent-runtime/retry stack:

- at-least-once delivery compatible with logically-once acceptance;
- task fingerprints/operation IDs;
- leases;
- bounded attempts;
- immutable accepted results;
- stale ownership rejection;
- restart reconstruction from durable state.

Recovery cannot broaden intent, weaken evidence standards, bypass Authorization, or claim Verification.

## 19. Current implementation alignment

The baseline already contains substantial execution safety: durable Runs, CAS transitions, workers/tasks, leases, bounded retries, capability grants, schema/budget/egress checks, cancellation, idempotent reuse, ambiguous non-idempotent redispatch rejection, pre/post binding checks, and provider-neutral Model Gateway.

The capability-first Solandra-facing Broker abstraction and complete ActionProposal/Authorization/ExecutionReceipt/Verification composition remain target design, not runtime claims.

## 20. Validation direction

Later exact-revision probes should prove:

- Solandra can request a capability without provider-specific Product logic;
- wrong subject/basis/permission/schema fails before dispatch;
- model/tool proposal cannot self-authorize;
- factual output cannot bypass Knowledge Trust;
- ordinary Recommendation does not require formal Decision Engine execution;
- consequential capability cannot dispatch without exact Authorization;
- duplicate/retry/restart behavior preserves one logical action;
- ambiguous non-idempotent completion fails closed;
- ExecutionReceipt survives restart and remains distinct from Verification;
- verification claims require actual verification evidence.
