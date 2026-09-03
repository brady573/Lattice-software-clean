# Lattice Execution and Capability Architecture

Status: **RECONCILED DRAFT — Owner-directed cross-system execution architecture**

Drafted: **August 31, 2026**

Repository reconciliation baseline: `main @ b7d9fa123358f8437da67d06c7739fe1992c365c`, tree `41dfdf1de56bcadfb69c30b909ca165033600a68`.

## 1. Purpose

Lattice needs one permanent architecture for **how bounded work is licensed, executed, recovered, and handed back to the Product authorities that decide what the result means**.

The stable composition is:

```text
canonical IntentVersion
        |
        +--> conditional DecisionPlan for qualified decision work
        |
        v
Run
        |
        | Runtime-owned execution policy
        v
bounded capability operation
        |
        | operational result + provenance
        v
semantic-owner admission / consumption
        |
        +--> V36 Truth Core for factual/evidence-bearing material
        |
        +--> another qualified Product owner where explicitly defined
        |
        +--> Lattice Decision Engine only for qualified decision work
        |
        +--> KnowledgeOutcome or Resource without decision machinery
```

The central rule is:

> **Execution determines how licensed work is performed; it does not determine what the result means.**

- **Lattice Intent Authority** owns canonical USER meaning.
- **DecisionPlan**, when decision work is qualified, freezes the faithful planning projection of one exact IntentVersion for one decision Run. Knowledge and non-decision Action Preparation Runs have no DecisionPlan.
- **Lattice Execution Runtime** owns durable operational lifecycle, execution-policy checks, dispatch, cancellation, retries, recovery, and operational result persistence.
- **Capability mechanisms** perform only operations licensed by Product-owned policy.
- **Lattice Model Gateway** is one non-authoritative capability mechanism/class, not the execution architecture itself.
- **V36 Truth Core** owns factual admission and truth sufficiency.
- **Lattice Decision Engine** owns eligibility, comparison, frontier, and StructuredDecision semantics.
- **Solandra Experience** presents authoritative Product state without acquiring execution, truth, or decision authority.

A provider, model, tool, worker, queue, retry, adapter, or successful API call does not become Product authority merely because work passed through it.

## 2. Authority and relationship to other design sources

This document is a cross-system execution architecture. It does not replace the more-specific Product authorities that define USER intent, V36 epistemic semantics, Decision Engine semantics, persistence, privacy, security, or presentation.

It must remain consistent with, and is subordinate at their applicable boundaries to:

- `The-Core-Lattice-Philosophy.md` — highest Product-design authority and first filter;
- `Lattice-Foundational-Design-Principle.md` — subordinate foundational elaboration;
- `Lattice-Living-Software-Design-to-1.0.md` plus confirmed amendments — canonical forward Product direction;
- `Lattice-Architecture-Integrity.md` — protected semantic ownership boundaries;
- `Lattice-System-Registry-and-Naming.md` — canonical subsystem vocabulary;
- `Lattice-System-Architecture.md` — current implementation structural map;
- `Lattice-State-and-Persistence-Architecture.md` — state ownership, versioning, reconstruction, deletion, and second-source-of-truth rules;
- `Lattice-Intent-and-Decision-Architecture.md` — semantic relationship among IntentVersion, DecisionPlan, V36 evidence, Decision Engine, and StructuredDecision;
- protected V36 specifications — controlling epistemic semantics; and
- qualified milestone/provider designs, including M9, only for narrower capability-specific requirements.

M9 remains the live-provider promotion and qualification architecture. This document owns the stable execution layer beneath M9 so provider-specific work does not become the accidental permanent specification for Runs, workers, grants, retries, cancellation, or operational recovery.

Where current implementation is narrower than this architecture, this document states the stable requirement without claiming the missing mechanism already exists as a first-class runtime field or API.

## 3. Foundational Product fit

The Foundational Design Principle requires Lattice to absorb internal machinery rather than forcing users to manage providers, workers, queues, retries, orchestration, or persistence.

This architecture therefore follows four rules:

1. **Capability before provider.** Define the work the Product needs before choosing the mechanism that supplies it.
2. **Bounded execution before general autonomy.** License the minimum operation required for one exact Product purpose.
3. **Hide machinery, preserve authority.** Users should not have to manage execution internals, but material authorization and trust boundaries remain explicit.
4. **Complexity must earn its place.** New controllers, agent runtimes, worker classes, orchestration ledgers, or provider stacks are not Product goals by themselves.

The default design direction is to extend **Lattice Execution Runtime** rather than create a new top-level Tool Controller, Agent Runtime, Provider Runtime, or parallel orchestration authority.

## 4. Stable execution pipeline

The permanent operational path is:

```text
IntentVersion
   |
   +--> conditional DecisionPlan for qualified decision work
   |
   v
Run
   |
   v
execution-policy evaluation
   |
   +--> exact Product binding active?
   +--> capability licensed?
   +--> arguments valid?
   +--> budgets available?
   +--> required action authorization satisfied, where applicable?
   |
   v
CapabilityExecutor / worker / Model Gateway / research adapter
   |
   v
normalized operational result + provenance
   |
   v
Runtime persistence / continuation
   |
   v
owning semantic subsystem
```

No arrow transfers semantic authority merely because information crosses a process, provider, queue, or persistence boundary.

### 4.1 DecisionPlan is the execution basis, not execution authority

For qualified decision work, DecisionPlan binds one exact IntentVersion to the faithful planning material used by one Run. Generic Run execution binds directly to the authoritative IntentVersion and does not synthesize a DecisionPlan.

It does not:

- dispatch workers;
- license arbitrary capabilities;
- decide retries;
- admit evidence;
- mutate USER intent;
- select a provider merely by naming one in prose; or
- authorize consequential external action.

### 4.2 Run is the durable operational envelope

A Run is the durable operational composition envelope through which execution occurs.

Execution Runtime owns:

- Run status;
- Run operational version/epoch;
- progress and continuation;
- cancellation;
- dispatch;
- worker coordination;
- retry/recovery state;
- operational failure state; and
- persistence of operational outputs and embedded subsystem-owned outputs.

Persisting V36 state, StructuredDecision state, model output, or Solandra rendering in a Run does not transfer semantic ownership of those values to Runtime.

### 4.3 Capability operation is subordinate to the Run

A capability operation is one bounded executable action inside exact Product context.

It must not become a freestanding autonomous authority capable of broadening USER intent, inventing new permissions, changing decision criteria, or attaching its result to another Run merely because the operation completed successfully.

## 5. Run lifecycle

### 5.1 Current implemented state machine

Current canonical source defines these available states and conditional paths:

```text
CREATED
  |
  v
UNDERSTANDING
  |
  +--> AWAITING_CLARIFICATION
  |        |
  |        +--> UNDERSTANDING
  |
  v
PLANNING
  |
  v
INVESTIGATING
  |
  v
VALIDATING
  |
  +--> INVESTIGATING
  |
  +--> COMPLETED (Knowledge or Action Preparation)
  |
  +--> DECIDING --> COMPLETED (qualified decision work only)
```

Applicable nonterminal states may also transition to `CANCELLED` or `FAILED`. `COMPLETED`, `CANCELLED`, and `FAILED` are terminal in the current implementation.

### 5.2 Stable lifecycle semantics

Intermediate state names may evolve, but the architecture requires:

- one durable Run identity;
- one exact IntentVersion basis per Run and, only for qualified decision work, one faithful DecisionPlan;
- explicit durable operational progress;
- compare-and-swap or equivalent exact ownership for accepted state changes;
- no silent reopening of terminal state;
- cancellation that prevents late work from becoming current output;
- durable waits that do not depend on coordinator process survival; and
- restart recovery from canonical durable state rather than logs or generated prose.

### 5.3 Run version is an operational epoch

`Run.version` is Runtime's operational concurrency/ownership epoch.

It is not an IntentVersion, V36 truth revision, provider attempt, decision revision, model-context version, or presentation revision.

A worker or coordinator that no longer owns the expected Run epoch must fail rather than overwrite newer state.

## 6. Execution Runtime ownership

Lattice Execution Runtime owns **operational execution**, including:

- durable Run lifecycle;
- exact Run/subject/IntentVersion execution binding;
- execution-policy evaluation;
- dispatch and queue coordination;
- operation identity;
- capability-license enforcement;
- worker/task lease ownership;
- call/time/input/output/egress budget enforcement;
- timeout and cancellation propagation;
- retries and backoff;
- idempotent replay handling;
- ambiguous-completion handling;
- immutable accepted operational results;
- stale-result rejection;
- restart recovery; and
- handoff of results to the semantic authority that may admit or consume them.

Runtime does **not** own:

- USER meaning;
- evidence admission or evidence strength;
- criterion semantics;
- eligibility/ranking/frontier semantics;
- final-choice delegation semantics;
- consequential external-action authorization semantics; or
- presentation authority.

Runtime answers:

> **What exact bounded work is licensed to execute now, and how can it proceed safely across failure and restart?**

It does not answer whether an external claim is true or which candidate should win.

## 7. Capability model

### 7.1 Capability is a Product contract

A **capability** is a Product-defined executable operation with explicit identity, schema, scope, operational bounds, effect characteristics, and result contract.

A capability is not synonymous with a provider, model, worker, tool-call string, connector, API endpoint, queue, script, or permission to execute arbitrary code.

Those are mechanisms that may implement or transport a capability.

### 7.2 Current CapabilityGrant

Current source defines a narrow `CapabilityGrant` containing:

```text
capabilityId
capabilityVersion
runId
subjectId
intentVersionId
role
tool schema
maxCalls
timeoutMs
maxInputBytes
maxOutputBytes
egress policy
idempotency class
```

Current roles are `MODEL_ASSISTANCE` and `RESEARCH`. Those are implementation facts, not a permanent limit on all future capability roles.

### 7.3 CapabilityGrant is a bounded execution license, not sufficient execution authority

A `CapabilityGrant` establishes what operation **may be considered for execution** within exact bounds.

It is necessary but not sufficient by itself.

Actual dispatch/execution also requires the applicable Product-owned policy checks, including:

```text
exact request/grant binding
active Run / subject / IntentVersion state
valid declared capability and arguments
remaining execution budgets
applicable side-effect/action authorization gates
```

Therefore:

> **CapabilityGrant != unconditional permission to execute.**

This distinction matches current source, where an exact grant is still checked against request identity and Product binding state before and after execution.

### 7.4 Exact binding

Execution must preserve the exact relationship among, where applicable:

```text
Run
Authenticated Subject
IntentVersion
Capability Role
Capability ID/version
Operation ID
```

A request with a mismatched Run, subject, IntentVersion, or role must fail closed.

Later correction, deletion, subject invalidation, cancellation, or supersession does not silently retarget an already-issued result to successor state.

### 7.5 Binding-state guard

Current source distinguishes:

```text
ACTIVE
STALE_RUN
SUPERSEDED_INTENT
SUBJECT_UNAVAILABLE
DELETED
```

The permanent architecture requires Product-owned binding checks at two critical points:

1. **before external execution** — deny dispatch if the Product basis is already invalid;
2. **after execution before release/admission** — prevent a completed result from becoming current Product output if the controlling basis changed during execution.

## 8. Tool proposals versus execution authority

### 8.1 Model/tool output is proposal material

A model may emit a structured tool-call proposal where the Model Gateway contract permits it.

That proposal is not execution authority.

```text
model output
   |
   v
canonical tool-call proposal
   |
   | proposal only
   v
Runtime policy evaluation
   |
   +--> exact capability license
   +--> active binding
   +--> schema/budget checks
   +--> action-authorization gate if required
   |
   v
execution
```

### 8.2 Exact schema validation

Current capability policy requires the proposal to match the exact granted tool name and fail-closed argument schema. Undeclared arguments, missing required arguments, wrong primitive types, or a different tool name fail before execution.

`additionalProperties=false` is part of the current fail-closed contract.

### 8.3 No generalized model authority

Models must not acquire generalized authority such as unrestricted shell, filesystem, database, network, repository, credential, production, or external-action permission.

A broad-looking user experience must still decompose into exact Product-owned capabilities and applicable authorization gates.

## 9. USER semantic confirmation, decision delegation, and action authorization remain distinct

The Intent and Decision Architecture establishes that exact USER confirmation authorizes only the specific pending semantic interpretation it answers.

It does **not** automatically establish:

- tool execution permission;
- evidence admission;
- recommendation correctness;
- final-choice delegation; or
- permission to perform a consequential external action.

Likewise, **final-choice delegation** is a Decision Engine selection authority. It permits a scoped selected outcome where qualified; it does not by itself authorize an external transaction or mutation.

The stable separation is:

```text
USER semantic confirmation
    !=
Decision Engine final-choice delegation
    !=
execution-policy license
    !=
consequential external-action authorization
```

The exact Product contract for future external-action authorization must be separately qualified. This architecture preserves the boundary without inventing that future semantic contract.

## 10. Workers

Workers are operational execution processes, not Product authority tiers.

A worker may:

- claim durable work;
- execute already-licensed operations after Runtime policy gates pass;
- report normalized success/failure;
- persist operational results through Runtime-owned stores;
- obey leases and cancellation; and
- release work for retry when the exact policy permits it.

A worker may not independently:

- broaden USER intent;
- decide evidence sufficiency or truth;
- add an undeclared capability;
- expand budgets;
- attach a result to another Run;
- reinterpret failure as success; or
- bypass a required action-authorization gate.

### 10.1 At-least-once delivery

Current Run workers explicitly assume at-least-once dispatch. Correctness therefore cannot depend on exactly-once queue delivery.

Stable correctness comes from durable operation/task identity, exact Run epochs, leases, idempotency semantics, immutable accepted results, and stale-result rejection.

### 10.2 Leases

A worker lease grants temporary operational ownership of an attempt. It does not grant semantic authority over the task result.

Expired/lost lease completion must not overwrite a newer accepted attempt.

### 10.3 Worker multiplicity

One worker process or many worker classes are implementation choices. Multiplicity is justified only when specialization, reliability, isolation, or recoverability creates real Product value.

## 11. Execution budgets

Every capability operation must have enough Product-owned bounds to prevent open-ended execution.

Current source enforces:

```text
maxCalls
callNumber
timeoutMs
maxInputBytes
maxOutputBytes
egress policy
```

Provider/model discretion may not expand these bounds.

### 11.1 Call budget

Calls beyond the licensed budget fail rather than silently extending work.

### 11.2 Time budget

Execution must be cancellable and Product-time-bounded. Provider timeout, worker lease, Run-level budget, and per-capability timeout are distinct concepts unless a later qualified design proves they can safely collapse.

### 11.3 Input/output bounds

Inputs and outputs must be bounded before they become unbounded persistence, context, or network amplification paths.

An oversized result is an operational failure, not partially trusted semantic evidence.

### 11.4 Egress policy

Current grants support `NONE` or an exact HTTPS-origin allowlist. Network reachability does not create permission to contact an endpoint.

## 12. Side effects: permanent multi-axis classification

The first draft of this document combined effect type, reversibility, and consequence in one enum. Dedicated reconciliation rejects that model because those properties are independent.

A reversible mutation can still be highly consequential. An irreversible mutation can be low-impact. An idempotent operation can still require explicit user authorization. External processing may not mutate the USER's target state but can still have privacy, retention, quota, or cost effects.

Therefore capabilities must be classifiable across **separate axes**.

### 12.1 Effect kind

The stable minimum distinction is:

```text
OBSERVE
EXTERNAL_PROCESSING
MUTATE
```

**OBSERVE**
- reads or observes state;
- does not intentionally change the target state;
- transport/access logging does not by itself reclassify the target operation as mutation.

**EXTERNAL_PROCESSING**
- causes an external system/provider to process supplied data;
- does not intentionally mutate the USER's target state;
- model/provider inference commonly belongs here;
- privacy, retention, quota, cost, and ambiguous-completion implications still apply.

**MUTATE**
- intentionally changes Product-adjacent or external target state.

A future implementation may choose different enum names, but it must preserve the material distinction among observation, external processing, and intentional mutation.

### 12.2 Consequence / action-authorization class

Separately, execution must be able to distinguish at least:

```text
ROUTINE
CONSEQUENTIAL
```

A **CONSEQUENTIAL** operation is one whose unintended or duplicate execution could materially affect the USER, another party, production state, finances, permissions, security, or similarly significant state.

Consequence class determines whether an additional exact action-authorization boundary is required. It is not derived merely from `MUTATE` or from idempotency.

### 12.3 Reversibility

Where mutation/recovery policy depends on it, the contract must separately represent whether the effect is:

```text
REVERSIBLE
IRREVERSIBLE
UNKNOWN
```

Reversibility describes recovery possibility. It does not determine whether execution was authorized or safe.

### 12.4 Idempotency

Current source implements:

```text
IDEMPOTENT
NON_IDEMPOTENT
```

This describes whether the same operation identity can be safely re-dispatched after ambiguous completion under the exact capability contract.

Idempotency does not imply consequence-free execution.

### 12.5 Semantic effect remains separate

No operational classification makes output authoritative intent, truth, or decision state. Semantic admission remains owned by the applicable Product authority.

## 13. Operation identity and idempotency

Every retryable or externally dispatched capability operation needs one stable operation identity.

Attempt numbers, queue deliveries, timestamps, worker IDs, and process IDs do not make the semantic operation new.

### 13.1 Successful-result reuse

Current capability policy reuses a prior successful result when operation identity matches and the controlling binding remains active.

The stable rule is:

> **Duplicate delivery should reuse proven successful work instead of executing it again merely because delivery repeated.**

### 13.2 Ambiguous completion

If execution may have occurred but completion is unknown, state is **ambiguous**.

For a `NON_IDEMPOTENT` capability, current source fails closed rather than blindly redispatching. That is a permanent execution invariant.

### 13.3 Deduplication mechanisms are not operation identity

Process-memory duplicate suppression, provider request IDs, queue deduplication, and durable task fingerprints are useful mechanisms but do not individually replace Product-owned operation identity.

## 14. Retries

Retry policy belongs to Runtime under the exact operation/capability contract.

An ordinary retry must preserve every material execution semantic, including where applicable:

```text
Run
subject
IntentVersion
capability ID/version
role
operation identity
input semantics
context projection policy
effect/consequence/reversibility/idempotency classification
required provenance contract
```

Changing material semantic input may create a new operation rather than a retry.

Rate limits, outages, transport failures, or lease loss do not authorize broader tools, different USER intent, unqualified fallback, or duplicate consequential action.

When retry budget is exhausted, Runtime records operational exhaustion. The semantic owner determines what the absence of the result means.

## 15. Cancellation

Cancellation is durable Runtime-owned lifecycle state, not merely an in-memory `AbortSignal`.

- **Before dispatch:** cancelled/inactive work must not execute.
- **During execution:** Runtime attempts to propagate abort at the nearest Product-owned boundary.
- **After external dispatch:** cancellation does not prove the external operation did not complete.
- **Before result release/admission:** Runtime rechecks controlling binding state.

A late result after cancellation, intent supersession, subject invalidation, deletion, or stale Run epoch does not become current Product output.

`CANCELLED` and `FAILED` remain distinct operational states.

## 16. Failure and recovery ownership

Execution failure and semantic insufficiency are different problems.

### 16.1 Runtime owns operational recovery

Runtime owns recovery for worker crash, process restart, lease expiry, queue redelivery, timeout, cancellation propagation, provider/tool unavailability, rate limiting, transport failure, malformed operational result, budget failure, stale Run epoch, ambiguous completion, and retry exhaustion.

### 16.2 Capability executor owns bounded mechanism behavior

An executor performs the licensed operation, obeys Product-owned cancellation/egress constraints, and normalizes mechanism-specific outcome/provenance into the capability contract.

It does not own the durable retry ledger or semantic meaning of the result.

### 16.3 V36 owns epistemic resolution

For factual/research-bearing output, V36 decides admissibility, contradiction/corroboration, staleness, sufficiency, further research, and authoritative truth state.

Repeated operational success cannot substitute for V36 admission.

### 16.4 Decision Engine owns decision state

If exact admitted state remains insufficient for eligibility/comparison/selection, the Decision Engine preserves the valid decision state. Runtime cannot invent facts or broaden intent to force completion.

### 16.5 Solandra owns faithful explanation

Solandra may explain operational failure, waiting, incomplete evidence, or unresolved decisions. Presentation does not acquire failure, truth, or decision authority.

## 17. Durable orchestration

Current orchestration already demonstrates stable patterns:

- deterministic research-task fingerprints from material inputs;
- dependency graphs with cycle/unknown-dependency checks;
- bounded attempts;
- worker leases;
- immutable accepted results;
- durable dispatch logical keys;
- acknowledgement/release; and
- stale ownership rejection.

An attempt is execution history, not a new semantic task.

Dispatch transport is recoverable operational state, not the authoritative record of what a capability means.

## 18. Result and provenance contract

Every material capability result must carry enough provenance for the downstream Product owner to establish what exact operation produced it.

The stable contract must be able to represent, where applicable:

```text
operationId
capabilityId
capabilityVersion
runId
subjectId
intentVersionId
role
input/argument identity
attempt/reuse state
normalized operational outcome
effect/consequence/reversibility/idempotency classification
mechanism/provider identity where relevant
route/egress provenance where relevant
result identity/digest where useful
```

The exact persistence shape may differ by capability class.

Operational provenance proves how work executed. It does not independently prove an external claim true.

When a successful result is reused, provenance must remain attributable to the original operation; replay must not pretend another external execution occurred.

## 19. Semantic admission boundary

Operational persistence and semantic admission remain separate.

For factual/research-bearing material:

```text
capability result
      |
      | operational result only
      v
V36 continuation / admission
      |
      +--> reject
      +--> unresolved
      +--> request more research
      +--> admit qualified evidence
      |
      v
validated truth state
```

Operational success may still be epistemically unusable, stale, contradictory, or outside the required provenance contract.

Only the owning semantic subsystem resolves those conditions.

## 20. Decision boundary

The Decision Engine consumes exact planning semantics plus admitted evidence, not raw worker/provider success.

```text
DecisionPlan / exact Run request
             |
             +-------------------+
                                 |
                                 v
                          Decision Engine
                                 ^
                                 |
             +-------------------+
             |
        V36-admitted evidence
```

Capability output cannot bypass V36 for factual claims merely because it is structured, repeated, high-confidence, or provider-qualified.

## 21. Model/provider execution is one capability class

Lattice Model Gateway is a provider-neutral, non-authoritative capability boundary. It may supply qualified interpretation assistance, structured proposals, bounded analysis, rendering assistance, tool-call proposals, and other model roles.

It does not own Run lifecycle, Product binding, capability licensing, semantic admission, or consequential external-action authorization.

A local model, hosted provider, broker, relay, or future transport is a mechanism supplying capability.

Provider substitution must not silently change semantic ownership, USER intent, V36 admission standards, Decision Engine authority, action-authorization requirements, privacy boundary, or cost/production boundary.

### 21.1 M9 ownership remains provider-specific

M9 may own:

- live-provider promotion;
- requested/actual route provenance;
- local/brokered/direct provider classifications;
- role-specific provider/model qualification;
- routing/fallback qualification;
- provider retention/privacy evidence;
- zero-cost/provider-specific qualification evidence; and
- provider-specific acceptance evidence.

This document owns the stable layer beneath those details:

```text
Run
 -> policy checks
 -> bounded capability operation
 -> result/provenance
 -> retry/recovery
 -> semantic admission
```

## 22. Research capability remains subordinate to Runtime and V36

The durable research composition is:

```text
V36
 -> NEEDS_RESEARCH + immutable checkpoint

Execution Runtime
 -> schedules exact licensed work

Research worker/capability
 -> operational result + provenance

Execution Runtime
 -> persists exact result

V36
 -> resumes exact checkpoint with exact results
 -> admit / reject / request more / validate
```

Research workers do not decide whether evidence is sufficient or true.

## 23. Context and data minimization

Capability execution receives only the minimum Product context required for the exact role.

A capability license or worker assignment does not authorize broad export of Conversation history, account data, historical facts, preferences, secrets, or persistent memory.

Data projection is an execution-input policy, not a new memory authority.

## 24. Secrets and credentials

Secrets are operational configuration, not canonical Product semantic state.

They must not become IntentVersion state, DecisionPlan semantics, Run semantic request content, V36 truth, StructuredDecision state, Conversation content, or Solandra presentation state.

Executors receive only secret material required at the exact operational boundary that needs it.

Missing/invalid credentials are operational configuration failures.

## 25. Consequential external-action boundary

This architecture defines execution mechanics but intentionally does **not** define a blanket Product contract for consequential external actions.

For any future consequential action capability, execution must fail closed unless separately qualified Product semantics establish, at minimum:

- what exact action is being authorized;
- who may authorize it;
- scope and freshness of that authorization;
- whether authorization is reusable or single-use;
- required effect/consequence/reversibility/idempotency classification;
- exact operation identity;
- applicable safety/privacy/security constraints; and
- result/provenance sufficient to prevent blind duplicate execution.

The following do **not** themselves authorize a consequential external action:

- a Decision Engine recommendation;
- frontier membership;
- a delegated selected option;
- a generic USER confirmation;
- a model/tool proposal;
- a CapabilityGrant alone; or
- provider availability.

Development/production governance may impose additional Owner-only controls. Those operational governance rules remain outside this Product architecture and are not redefined here.

## 26. Staleness and supersession

Late work does not become current merely because it completed.

A result is operationally stale when a material controlling basis changed before acceptance, including where applicable:

- Run epoch changed;
- Run became cancelled/terminal;
- IntentVersion was superseded for the active flow;
- subject became unavailable;
- owned graph was deleted;
- capability/version was invalidated; or
- the exact semantic checkpoint that requested the work is no longer current.

Runtime rejects stale attachment. The owning semantic subsystem determines successor state.

## 27. Provider/tool substitution

A replacement executor/provider/tool may be used as ordinary retry/fallback only when the exact qualified capability contract permits it and material execution semantics remain preserved.

Substitution must not silently change:

- effect kind;
- consequence class;
- reversibility;
- idempotency;
- privacy/data boundary;
- egress policy;
- result/provenance contract;
- role semantics;
- truth standard;
- action-authorization requirement; or
- cost/production boundary.

A material change is a new operation/policy decision, not a transparent retry.

## 28. Failure taxonomy

| Failure class | Primary owner | Treatment |
| --- | --- | --- |
| Invalid grant/request binding | Runtime policy | Fail closed before dispatch |
| Inactive Product binding | Runtime policy | Fail closed / stale result |
| Undeclared or malformed proposal | Runtime capability policy | Reject before execution |
| Budget exceeded | Runtime | Stop; never auto-expand |
| Cancellation | Runtime | Abort where possible; preserve durable cancellation |
| Timeout | Runtime/capability boundary | Record operational failure/ambiguity as applicable |
| Provider/tool unavailable | Runtime | Retry/fallback only when qualified |
| Worker/lease loss | Runtime | Reclaim/retry through durable identity |
| Duplicate delivery | Runtime | Reuse/deduplicate through operation/task identity |
| Ambiguous non-idempotent completion | Runtime | Fail closed; no blind redispatch |
| Oversized/malformed result | Capability policy | Reject operationally |
| Binding changed after execution | Runtime | Do not release as current output |
| Evidence insufficient/conflicting | V36 | Epistemic resolution |
| Decision unresolved | Decision Engine | Preserve valid frontier/uncertainty |
| Required external-action authorization absent | Applicable Product action-authority contract | Do not execute |

## 29. Recovery after restart

Process restart must not require reconstructing execution authority from transient logs.

Durable recovery derives from, where applicable:

```text
DecisionPlan binding
Run status/version
operation/task identity
dispatch/outbox state
attempts/leases
accepted operational results
V36 continuation checkpoints
```

Adapters, network clients, worker processes, model sessions, and provider connections are reconstructable mechanisms.

A restart may create a new attempt; it does not create a new semantic operation merely because process identity changed.

## 30. Observability and audit

Execution observability should answer:

- which capability/operation executed;
- for which Run/subject/IntentVersion;
- under which license/version;
- which Product binding/policy gates were satisfied;
- with what budgets and egress limits;
- whether work executed or reused prior success;
- which attempt/worker handled it;
- which provider/tool route was used where relevant;
- whether cancellation/timeout/retry occurred;
- whether the result became stale; and
- where the result was handed for semantic admission.

Observability does not expose secrets or become semantic authority.

## 31. Current implementation alignment

### 31.1 Implemented today

Current canonical source already demonstrates:

- durable Run status/version lifecycle;
- expected-status/expected-version state transitions;
- restartable coordinator ticks;
- at-least-once Run dispatch;
- durable research task fingerprints and dependencies;
- worker attempts and leases;
- bounded retry counts;
- immutable accepted research results;
- dispatch acknowledgement/release;
- capability grants bound to Run/subject/IntentVersion/role;
- exact fail-closed tool schema validation;
- call/time/input/output/egress bounds;
- cancellation propagation;
- idempotent successful-result reuse;
- ambiguous non-idempotent redispatch rejection;
- pre/post execution binding checks; and
- a provider-neutral Model Gateway outside semantic authority.

### 31.2 Stable requirements not yet fully first-class

Current source does not yet expose one complete first-class model for:

- a permanent cross-capability result/provenance envelope independent of M9;
- the multi-axis effect/consequence/reversibility classification established here;
- a uniform future external-action authorization hook for consequential capabilities;
- general cross-capability substitution semantics; or
- this permanent execution architecture as the stable source beneath milestone/provider designs.

Those are architecture requirements, not claims of completed runtime implementation.

## 32. Anti-collapse invariants

Future work must preserve:

1. `DecisionPlan != execution authority`.
2. `Run lifecycle != USER intent`.
3. `CapabilityGrant != unconditional execution permission`.
4. `Model/tool proposal != execution authorization`.
5. `USER semantic confirmation != consequential external-action authorization`.
6. `Final-choice delegation != consequential external-action authorization`.
7. `Worker completion != truth`.
8. `Provider success != V36 admission`.
9. `Attempt identity != operation identity`.
10. `Retry != new semantic operation` unless material semantics changed.
11. `Queue delivery != authoritative execution identity`.
12. `Operational provenance != factual proof`.
13. `Idempotent != consequence-free`.
14. `Reversible != non-consequential`.
15. `Cancellation != proof that external execution never occurred`.
16. `Provider/model mechanism != architecture authority`.
17. `Persistence != semantic ownership`.
18. `Failure to obtain evidence != evidence of the opposite claim`.
19. `Decision != authorization`.
20. `Authorization != execution`.
21. `Execution != verification`.

## 33. Validation design

Future exact-revision Product-observable probes should demonstrate at least:

1. wrong Run binding rejected before dispatch;
2. wrong subject binding rejected before dispatch;
3. wrong IntentVersion binding rejected before dispatch;
4. inactive binding rejected even with a structurally valid CapabilityGrant;
5. undeclared tool proposal cannot execute;
6. extra/malformed tool arguments fail closed;
7. calls beyond budget cannot expand their own grant;
8. oversized input fails before execution;
9. oversized output is not accepted as successful output;
10. timeout aborts the local execution boundary;
11. cancellation before dispatch prevents execution;
12. cancellation/binding invalidation during execution prevents current-result release;
13. duplicate successful operation identity reuses accepted result rather than re-executing;
14. ambiguous non-idempotent completion cannot be blindly redispatched;
15. queue redelivery does not create duplicate semantic operations;
16. stale lease completion cannot overwrite newer accepted work;
17. Run restart resumes from durable state without coordinator memory;
18. worker restart reclaims work using durable identity;
19. provider/tool substitution preserves exact qualified contract or fails closed;
20. factual provider/model output cannot bypass V36;
21. operational failure cannot alter V36 evidence strength by itself;
22. Decision Engine consumes admitted evidence rather than raw execution success;
23. generic USER confirmation cannot authorize an unrelated external mutation;
24. final-choice delegation cannot authorize an external mutation;
25. a valid CapabilityGrant alone cannot bypass required consequential-action authorization;
26. capability provenance remains attributable to the exact Run/operation;
27. late result from a superseded IntentVersion cannot attach to successor flow; and
28. presentation cannot fabricate execution completion or semantic authority absent durable underlying state.

Passing these probes establishes bounded execution-contract behavior for the exact tested revision only. It does not independently establish production readiness, provider qualification, semantic acceptance outside the tested scope, or authorization for consequential production actions.

## 34. Relationship to M9 and later capability documents

Milestone/provider documents should define **what capability is being introduced or qualified**. This document defines **how Lattice executes capabilities in general**.

```text
Execution and Capability Architecture
  owns:
    Run operational lifecycle
    execution-policy boundary
    capability license semantics
    worker/task execution
    budgets
    cancellation
    retry/idempotency
    effect/consequence/reversibility classification
    result/provenance
    failure/recovery

M9 Live-Provider Promotion Architecture
  owns:
    provider/model qualification
    route provenance
    local/brokered/direct execution qualification
    provider privacy/retention evidence
    provider fallback/routing qualification
    provider-specific promotion evidence
```

M9 may refine provider-specific contracts but must not redefine generic Run/capability semantics merely because a provider changes.

## 35. Implementation guidance

When extending execution capability:

1. identify the required Product capability and role;
2. identify the semantic owner requesting the work;
3. bind work to exact Run/subject/IntentVersion/checkpoint state;
4. define the minimal input/result schema;
5. define call/time/input/output/egress budgets;
6. classify effect kind, consequence, reversibility, and idempotency separately;
7. define operation identity and ambiguous-completion behavior;
8. define cancellation behavior;
9. define any required external-action authorization gate;
10. define worker/restart recovery behavior;
11. define provenance needed downstream;
12. implement the smallest executor/adapter satisfying the contract;
13. route factual material through V36; and
14. validate exact-revision failure/replay behavior.

Do not begin with provider SDK shape, model brand, agent framework, queue technology, or worker count unless the qualified capability requirement actually depends on it.

## 36. Structural summary

```text
Intent Authority
    |
    v
IntentVersion
    |
    +--> DecisionPlan (qualified decision work only)
    |          |
    |          | exact decision binding
    |          v
    v
Run
    |
    v
Runtime execution-policy gate
    |
    +--> exact binding
    +--> capability license
    +--> schema/budgets
    +--> action authorization if required
    |
    v
Worker / CapabilityExecutor / Model Gateway
    |
    v
Operational result + provenance
    |
    +--> Runtime persistence / recovery
    |
    v
Semantic admission / consumption
    |
    +--> V36 for factual material
    |
    +--> KnowledgeOutcome / Resource
    |
    +--> Decision Engine -> StructuredDecision (qualified decision work only)
```

The permanent ownership rule is:

> **Execution Runtime owns how licensed bounded work proceeds and recovers. Capability mechanisms perform only the operation they are licensed to perform. Semantic Product authorities remain responsible for what results mean, and separate action-authority contracts remain responsible for consequential external execution.**

## 37. Draft status

This document is a reconciled Owner-directed draft against canonical `main @ b7d9fa123358f8437da67d06c7739fe1992c365c`.

Dedicated reconciliation against the permanent architecture set corrected two material first-draft risks:

1. `CapabilityGrant` is now explicitly a bounded execution **license**, not unconditional execution authority; Runtime policy and active Product binding remain required.
2. side-effect classification is now multi-axis, separating effect kind, consequence, reversibility, and idempotency rather than conflating them in one enum.

The reconciliation also explicitly separates USER semantic confirmation, Decision Engine final-choice delegation, execution licensing, and consequential external-action authorization.

This document introduces no runtime code, schema migration, provider activation, production deployment, production data mutation, secret change, paid infrastructure, or consequential external action.

If a future qualified subsystem design materially changes an execution semantic, this document must be reconciled rather than silently outranking the more-specific authority.
