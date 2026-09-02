# Lattice Reliability, Recovery, and Observability Architecture

Status: **RECONCILED DRAFT — Owner-directed cross-system reliability architecture**

Drafted: **August 31, 2026**

Dedicated reconciliation: **August 31, 2026**

Repository reconciliation baseline: `main @ f56d004e73f7b3cfc93f1a2aaa0571c763689898`, tree `6a7905a7799680eede60e6951cc386c029227824`.

## 1. Purpose

Lattice needs one permanent architecture for how Product work survives faults, restarts, duplicate delivery, transient infrastructure failures, stale state, provider/tool failure, reconnect, and partial execution without changing Product meaning or manufacturing authority.

The stable reliability objective is:

```text
accepted Product state
      |
      v
bounded durable work identity
      |
      v
attempt / dispatch / capability execution
      |
      +--> transient infrastructure noise
      |         |
      |         +--> recover below Product-visible boundary
      |
      +--> ambiguous or exhausted failure
                |
                v
      durable recovery state / explicit Product-visible failure
                |
                v
      reconnect / resume / safe replacement / user-facing explanation
```

The central rule is:

> **Recover at the lowest subsystem that can do so without changing Product meaning. Surface failure to the user only when the Product can no longer safely preserve, resume, replace, or truthfully explain the intended work.**

Reliability mechanisms may preserve execution and continuity. They do not create USER intent, factual truth, decision authority, authorization, or successful external action merely because recovery succeeded.

## 2. Authority and relationship to other architecture

This document owns the stable cross-system reliability model. It does not replace the authority of the subsystems whose state is being protected.

It must remain consistent with:

- `Lattice-Foundational-Design-Principle.md`;
- `Lattice-Architecture-Integrity.md`;
- `Lattice-System-Architecture.md`;
- `Lattice-State-and-Persistence-Architecture.md`;
- `Lattice-Intent-and-Decision-Architecture.md`;
- `Lattice-Execution-and-Capability-Architecture.md`;
- `Lattice-Resource-and-Action-Architecture.md`;
- V36 Truth Core specifications;
- M8 authentication/privacy/deletion decisions; and
- M9 provider-specific qualification/recovery design where provider behavior is involved.

This document generalizes reliability below milestone/provider-specific designs. M9 may specify provider qualification, routing/failover evidence, and provider-specific error normalization, but permanent retry, duplicate-suppression, restart, stale-state, replay, and Product-visible-failure semantics belong here and in their owning subsystems.

## 3. Foundational reliability principles

### 3.1 Meaning before availability

Lattice must not preserve availability by silently changing the meaning of a Run, relaxing truth requirements, switching subject scope, inventing authorization, or accepting stale results.

A failed operation may be retried or replaced only when the replacement is semantically equivalent under the exact current Product basis and governing capability/route policy.

### 3.2 Durable identity before retries

Retries are safe only when logical work has a durable identity distinct from an execution attempt.

```text
logical work identity != attempt identity != worker process != provider request
```

Attempt count may increase while logical Product work remains one item.

### 3.3 At-least-once delivery, logically once acceptance

Queues, workers, API calls, reconnects, and orchestration wake-ups may be delivered more than once.

The Product must therefore assume at-least-once execution surfaces while ensuring that durable acceptance of a logical result is idempotent and exact-basis guarded.

### 3.4 Recovery does not transfer authority

A recovered provider response remains provider output. A recovered research result remains subject to V36 admission. A replayed user request does not create a second IntentVersion. A reconnected UI does not become canonical state.

### 3.5 Ambiguity fails closed for non-idempotent effects

When an operation may have completed externally but Lattice cannot prove the outcome, blind redispatch is not recovery.

For non-idempotent or consequential actions, ambiguous completion must enter an explicit recovery state until the Product can determine the external state or obtain a new exact authorization where required.

### 3.6 Infrastructure noise should remain infrastructure noise

Healthy recovery from lease expiry, worker replacement, reconnect, transient provider failure, or duplicate delivery should not create unnecessary user-facing failure if the Product can continue safely within expected bounds.

## 4. Reliability vocabulary

### Logical work

One Product-level unit that should produce at most one accepted logical outcome for an exact basis.

### Attempt

One execution try for logical work. Attempts are replaceable and may fail without changing Product meaning.

### Dispatch

Delivery of work to a worker/provider/capability executor. Dispatch is not proof of execution or completion.

### Accepted result

The one durable operational result accepted for an exact logical-work identity and current Product basis.

### Replay

Re-submission of an already-known request/event/message. Replay is safe only through exact idempotency/provenance rules.

### Reconnect

A client/process re-establishing observation or continuation from durable Product state after disconnection or restart.

### Degraded operation

A bounded, explicitly scoped condition in which one capability, route, Resource producer, transport, or outcome path is unavailable while unaffected Product behavior continues without weakening semantic, provenance, subject, or authorization requirements.

Degradation is not a global permission to relax Product guarantees.

### Ambiguous completion

The Product cannot determine whether an externally significant operation completed.

### Product-visible failure

A failure that materially prevents the user from obtaining, trusting, resuming, or safely acting on the intended Product outcome.

### Infrastructure noise

A lower-level fault that is recovered within bounded subsystem policy without changing the Product-observable meaning or outcome.

## 5. Expected failure classes

Lattice must model failures by what recovery decision they require, not only by technology source.

### 5.1 Input and contract failures

Examples:

- invalid API payload;
- schema mismatch;
- malformed provider response;
- malformed tool proposal;
- undeclared capability;
- invalid capability arguments;
- missing required provenance;
- unsupported provider/model feature.

These are deterministic for the exact input/contract unless the input or dependency changes. They should not be retried unchanged.

### 5.2 Binding and staleness failures

Examples:

- stale Run epoch/version;
- superseded IntentVersion;
- terminal/cancelled Run;
- subject unavailable/deleted;
- stale presentation/resource version;
- result completing after the Product basis changed.

These are correctness guards, not transient infrastructure failures. The stale output is rejected rather than retried into the successor state.

### 5.3 Transient infrastructure failures

Examples:

- worker crash;
- API restart;
- broker restart;
- PostgreSQL connection interruption;
- temporary network loss;
- provider 429;
- provider 5xx;
- temporary provider unavailability;
- expired worker lease.

These may be retried only within the owner subsystem's bounded policy and only when retry semantics remain safe.

### 5.4 Timeout and uncertain-completion failures

Examples:

- timeout after provider may have processed a request;
- network connection lost after dispatch;
- worker crashes after external completion but before durable commit;
- response lost after a consequential external mutation.

These require distinguishing known-not-executed from unknown-completion. Unknown completion is not equivalent to ordinary transient failure.

### 5.5 Duplicate-delivery failures

Examples:

- repeated API idempotency key;
- duplicate orchestrator wake-up;
- queue redelivery;
- duplicate worker claim attempt;
- reconnect causing repeated client request;
- provider/client retry after a response was lost.

The correct response is reuse/conflict/deduplication, not duplicate semantic work.

### 5.6 Dependency and availability failures

Examples:

- required provider unavailable;
- required tool unavailable;
- no permitted route satisfies capability constraints;
- external network unavailable;
- database unavailable;
- required source cannot be reached;
- resource producer unavailable.

These may produce scoped degraded operation if a qualified alternative preserves Product meaning and the affected guarantee is explicit. Otherwise they become Product-visible unavailability.

### 5.7 Semantic insufficiency failures

Examples:

- V36 cannot admit enough evidence;
- material hard requirement remains UNKNOWN;
- intent remains insufficiently confirmed;
- Decision Engine cannot produce a responsible recommendation from current evidence.

These are not infrastructure errors and should not be hidden by retries. They route to the owning semantic subsystem.

### 5.8 Persistence/integrity failures

Examples:

- database transaction failure;
- migration/schema incompatibility;
- invariant violation;
- corrupt or impossible durable state;
- missing required immutable result/provenance row.

These fail closed. Automatic recovery is limited to cases where integrity can be established from authoritative durable state.

### 5.9 Authorization/privacy failures

Examples:

- authentication failure;
- subject mismatch;
- deletion state changes during operation;
- capability grant no longer valid;
- attempted egress outside allowlist;
- missing consequential-action authorization.

These are policy decisions, not transient retry candidates.

## 6. Recovery ownership matrix

Recovery belongs to the subsystem that owns the failed invariant.

| Failure surface | Primary recovery owner | Safe recovery | Must not do |
|---|---|---|---|
| API validation/idempotency | API/application boundary + durable idempotency store | return existing result, deterministic validation error, or explicit idempotency conflict | create duplicate semantic work |
| Intent confirmation/correction | Lattice Intent Authority | preserve pending proposal, re-present exact clarification/confirmation, create successor IntentVersion only from valid USER provenance | infer a replacement USER meaning |
| Run lifecycle/stale epoch | Lattice Execution Runtime | CAS/reload current Run, reject stale attempt, resume from durable state | attach old result to new Run basis |
| Worker crash/lease expiry | Execution Runtime orchestration store | lease expiry, bounded re-claim, new attempt on same logical task | create new logical task because process died |
| Capability timeout/cancellation | Execution Runtime capability policy | cancel, bounded safe retry where idempotency permits, preserve ambiguous state where it does not | blindly redispatch non-idempotent ambiguous work |
| Provider 429/5xx/outage | Model Gateway + Execution Runtime route policy | normalized transient failure, bounded backoff/retry, qualified alternate route if exact policy permits | let provider error change Product authority |
| Broker failure/route loss | Model Gateway / route provenance owner | fail or reroute only if actual route identity/provenance remains sufficient | accept result with missing required actual-route provenance |
| Research execution failure | Execution Runtime research orchestration | bounded task retry; existing accepted result wins | manufacture negative evidence from execution failure |
| Evidence insufficiency | V36 Truth Core | request/continue qualified research or preserve uncertainty | convert repeated retrieval failure into factual truth |
| Decision insufficiency | Decision Engine | preserve frontier/UNKNOWN/no responsible selection | force a winner for UX continuity |
| Conversation/SSE disconnect | Conversation/continuity API + client projection | reconnect from durable state, resume using monotonic cursor/revision | trust stale local projection as canonical |
| Resource stale/open state | Resource application layer | reject stale hydration, supply replacement/current descriptor | serve cached actionable content as current |
| PostgreSQL connection/restart | persistence adapters + Runtime/continuity owners | reconnect, transaction retry where safe, resume from committed durable state | assume uncommitted state succeeded |
| deletion/subject transition | authenticated ownership/deletion boundary | fail closed, make child state inaccessible, reject late result | leak object existence or release late output |
| consequential external action ambiguous | Execution Runtime + action authorization owner | reconcile against authoritative external status or exact idempotency evidence, or require a qualified recovery workflow/new exact authorization | infer success/failure from telemetry, model output, timeout, or absence of a duplicate response; blind retry |

## 7. Run lifecycle reliability

Run lifecycle is durable Product state. Process lifetime is not Run lifetime.

A Run must be recoverable from committed state after:

- API restart;
- orchestrator restart;
- worker restart;
- temporary PostgreSQL disconnect;
- client reconnect.

Workers and coordinators may be stateless or restartable because correctness resides in durable Run/task state, exact versions/epochs, leases, accepted results, and CAS transitions.

A process restart must not:

- reset Run identity;
- reset semantic basis;
- duplicate accepted work;
- regress a terminal Run to active;
- resurrect cancelled work;
- attach stale work to a successor Run/IntentVersion.

## 8. Durable task and worker reliability

The stable orchestration model uses:

```text
logical task identity
      |
      v
claim + attempt + lease
      |
      +--> worker completes
      |        |
      |        v
      |   durable acceptance CAS
      |
      +--> worker crashes / lease expires
               |
               v
         bounded successor attempt
```

Worker processes are mechanisms. They do not own semantic or lifecycle authority.

A lease means temporary permission to work, not ownership of the task outcome.

If two workers race, durable storage determines which result can be accepted. Losing/late workers must observe stale/rejected completion rather than overwriting accepted state.

## 9. Retry architecture

### 9.1 Retry is owner-specific

There is no universal Lattice retry loop.

Each retry boundary must know:

- logical work identity;
- attempt identity;
- exact Product basis;
- max attempts/time budget;
- idempotency class;
- cancellation state;
- whether completion could be ambiguous;
- what state proves success;
- what state blocks further retry.

### 9.2 Deterministic failures are not retried unchanged

Examples:

- schema failure;
- invalid grant;
- undeclared capability;
- invalid arguments;
- stale binding;
- policy denial;
- malformed deterministic fixture/input.

Repair or change the input/configuration/implementation before a new attempt.

### 9.3 Transient failures may be retried boundedly

Examples:

- provider 429;
- provider 5xx;
- temporary network loss before confirmed dispatch;
- lease expiry;
- temporary database connectivity failure;
- restart during a reconstructible operation.

Retries remain subject to total Run/capability/provider budgets.

### 9.4 Retry does not reset budgets

A retry is another attempt against the same bounded logical work. It does not create a fresh unlimited call/time/token/network budget.

### 9.5 Retry cannot weaken routing or provenance

Fallback/retry may use another provider/model only when current qualified route policy permits it and actual route provenance remains explicit.

## 10. Idempotency and duplicate suppression

Duplicate suppression occurs at multiple layers because duplicates can originate at multiple layers.

### API layer

The same accepted idempotency key and exact request returns/reuses the original logical result. A materially different request under the same key conflicts rather than creating ambiguous work.

### Run/task layer

Deterministic logical identifiers/fingerprints prevent duplicate downstream tasks for the same exact basis.

### accepted-result layer

Once an immutable result has been accepted for a logical task/operation, equivalent retry/replay reuses that result rather than accepting another result.

### capability-operation layer

`operationId` identifies exact capability work. Prior `SUCCEEDED` evidence is reusable only for the same operation/binding. Ambiguous non-idempotent completion blocks blind redispatch.

### client/reconnect layer

Repeated reads/subscriptions/presentation requests must not mutate Product state merely because the client reconnects.

## 11. Cancellation

Cancellation is durable Product state, not merely an in-process abort signal.

Cancellation has two layers:

1. **authoritative cancellation intent/state** — Run/task/capability should no longer continue;
2. **best-effort execution interruption** — AbortSignal/provider cancellation/worker stop.

The second cannot be treated as proof that no external work occurred.

Late results after durable cancellation are rejected from current Product state. Where an external non-idempotent action may already have occurred, cancellation does not erase that ambiguity.

## 12. Ambiguous completion

Ambiguous completion is a first-class reliability state.

Examples:

```text
request dispatched
provider/tool/external system may have completed
network or process fails before durable outcome is known
```

For idempotent operations, exact operation identity plus governing idempotency semantics may permit safe redispatch under bounded policy.

For non-idempotent/consequential operations, recovery requires one of:

- reconciliation against an external status source that is authoritative for the action outcome and bound to the exact operation/target;
- provider/external idempotency semantics that prove the operation can be safely queried or reused;
- operator/user-visible recovery instructions when authoritative reconciliation is unavailable;
- a new explicitly qualified authorization/proposal where repeating the action would create a distinct action.

A model judgment, provider narrative, diagnostic event, timeout, missing callback, or inability to find a duplicate result is not enough to resolve ambiguity unless the owning external system's contract makes that observation authoritative for the exact operation.

`TIMEOUT` alone must not be interpreted as “did not happen.”

## 13. Provider and model failure

Provider/model execution is one capability class within this architecture.

Expected provider failures include:

- unavailable before dispatch;
- 429/quota/rate limit;
- 5xx;
- timeout;
- malformed response;
- malformed tool proposal;
- capability mismatch;
- lost network;
- broker failure;
- missing actual-route provenance;
- fallback route unavailable.

The Model Gateway normalizes provider-specific failure into stable Product-owned categories. Execution Runtime owns whether bounded retry/failover is permitted for the exact Run and capability.

A provider success response is operational success only. It is not V36 admission, Decision Engine acceptance, USER confirmation, or external-action authorization.

## 14. Tool/capability failure

Current capability execution already distinguishes:

```text
INVALID_GRANT
BINDING_MISMATCH
BINDING_INACTIVE
UNDECLARED_CAPABILITY
INVALID_ARGUMENTS
BUDGET_EXCEEDED
CANCELLED
TIMEOUT
AMBIGUOUS_REDISPATCH
OUTPUT_TOO_LARGE
BINDING_CHANGED_AFTER_EXECUTION
```

These error classes should remain stable Product-level operational semantics even if provider/tool adapters evolve.

`BINDING_CHANGED_AFTER_EXECUTION` is particularly important: work may have operationally completed but must not be released as current Product output when the Run/subject/IntentVersion basis is no longer active.

## 15. V36/research recovery

Research execution failure and truth-state uncertainty are different.

```text
research task operationally fails
        !=
claim is false
```

Execution Runtime owns worker/task recovery. V36 owns whether enough qualified evidence exists for factual admission.

A failed provider, unreachable source, timeout, malformed extraction, or exhausted retry may leave evidence `UNKNOWN`/insufficient. It must not become negative factual evidence unless the evidence itself supports that conclusion under V36 rules.

Accepted research results must be immutable for their exact task/basis. Duplicate or late attempts cannot create competing authoritative truth states.

## 16. PostgreSQL and transactional recovery

PostgreSQL is the durable source for state that the owning architecture designates durable. Process memory is not authoritative after restart.

Reliability rules:

- transaction commit is the durable boundary;
- failed/unknown transactions are not assumed committed;
- retry is allowed only for operations whose transaction semantics make it safe;
- CAS/version predicates prevent stale writers from winning;
- unique constraints/fingerprints support duplicate suppression;
- accepted immutable results are not overwritten by later attempts;
- process restart reconstructs from committed state;
- connection pools/adapters may reconnect without changing Product identity.

A database outage becomes Product-visible only when bounded reconnection/recovery cannot continue the requested Product operation safely or continuity expectations cannot be met.

## 17. API restart and stateless-service recovery

API/process restart should be invisible when requests have either:

- not been durably accepted; or
- been durably accepted with a stable retrieval/reconnect path.

For a request interrupted around acceptance, client retry uses the same idempotency identity so the server can return existing state rather than duplicate work.

API memory must not be the only copy of:

- accepted Run identity;
- canonical IntentVersion;
- durable research task;
- accepted capability/research result promised across reconnect;
- deletion state;
- user-visible durable conversation state.

## 18. Reconnect and replay

Reconnect means reconstructing from authoritative durable state, not replaying stale client state back into Product authority.

### Conversation reconnect

Reconnect restores durable Conversation/messages and current Product-linked state.

### Run reconnect

A client can retrieve current Run state and subscribe/resubscribe to progress after disconnect.

### SSE/event reconnect

Progress/event streams are transport acceleration, not canonical storage. A missed event must be recoverable by reading current durable state.

Where cursors/event IDs exist, they must be monotonic enough to prevent client regression. If an event history gap cannot be replayed safely, the client performs a full state refresh.

### Presentation reconnect

Presentation is reconstructed from accepted Product state. Stale local presentation cannot outrank a newer presentation revision.

### Resource reconnect

Open Resource state is restored only if the Resource version remains relevant/valid under the current Product basis.

## 19. Replay semantics

Replay is permitted only where the receiving boundary defines how exact duplicates behave.

Examples:

- USER message replay under an existing durable message/idempotency identity must not create another canonical meaning event;
- Run command replay returns existing Run/transition where exact;
- research task replay reuses logical task identity;
- capability replay reuses accepted exact operation result or follows idempotency/ambiguity rules;
- presentation GET replay is read-only and reconstructive.

Replay with changed material input is not a duplicate and must receive a new semantic/operation identity where appropriate.

## 20. Degraded operation

Degradation is scoped to the capability, route, Resource producer, transport, or outcome that lost a guarantee. Lattice must not collapse local degradation into a vague global mode that obscures which Product guarantees still hold.

A degraded path is valid only when:

1. the exact unaffected Product basis remains current;
2. the replacement/remaining capability is qualified for the same role where equivalence is required;
3. truth, intent, decision, subject, provenance, and authorization standards remain unchanged;
4. the lost capability/guarantee is explicit enough for downstream logic and presentation not to overstate availability; and
5. the user is informed when the loss materially affects what they can accomplish, trust, or resume.

Examples of valid scoped degradation:

- live provider unavailable but a qualified local capability can satisfy the exact role;
- optional media/resource hydration unavailable while conversation/decision state remains usable;
- SSE unavailable while durable polling remains functional;
- one nonessential Resource producer unavailable while existing authoritative outcome remains available.

Examples of invalid degradation:

- bypass V36 because live research is unavailable;
- drop a hard requirement because evidence cannot be fetched;
- switch to an unqualified provider silently;
- omit actual-route provenance;
- treat stale cached Resource data as current;
- execute a consequential action without required authorization because the preferred path failed.

Degradation is therefore a statement about lost capability or delivery quality, not a downgrade of Product truth or authority.

## 21. Product-visible failure versus infrastructure noise

### Infrastructure noise

A failure remains internal when all are true:

1. the exact Product request/basis remains valid;
2. bounded recovery is permitted;
3. recovery does not change semantic meaning or authorization;
4. user-visible progress does not materially regress or lie;
5. final accepted outcome is equivalent to the intended Product outcome; and
6. the event is still recorded for diagnostics/metrics where material.

Examples:

- worker process restart followed by lease recovery;
- duplicate queue delivery suppressed;
- transient DB reconnect with no lost committed state;
- provider 429 retried within qualified route policy;
- SSE reconnect followed by state refresh.

### Product-visible failure

Failure becomes user-visible when one or more are true:

- bounded recovery is exhausted;
- required capability remains unavailable;
- state cannot be reconstructed to the promised continuity level;
- completion is ambiguous and user action is needed;
- safe retry requires new authorization;
- a required source/evidence gap prevents responsible progress;
- a requested artifact/action cannot be produced;
- user-visible state may be stale or incomplete;
- Product integrity cannot be established.

The message should describe the Product consequence and next safe path, not raw stack traces/provider internals.

## 22. Product-visible reliability states

Product-visible reliability state is broader than failure. The Product contract must not classify normal cancellation, supersession, or active recovery as failures merely because they appear in reliability handling.

Conceptually separate:

### Failure / inability states

```text
TEMPORARILY_UNAVAILABLE
RESULT_AMBIGUOUS
INSUFFICIENT_EVIDENCE
UNSUPPORTED_CAPABILITY
INTEGRITY_FAILURE
```

### Continuation / lifecycle states

```text
RECOVERY_IN_PROGRESS
ACTION_REQUIRED_TO_CONTINUE
REQUEST_SUPERSEDED
CANCELLED
```

`CANCELLED` may be the intended USER outcome. `REQUEST_SUPERSEDED` may be a correct stale-work rejection. `RECOVERY_IN_PROGRESS` may represent healthy bounded recovery. None should inflate Product failure rates simply because it is reliability-relevant.

Exact API enums may differ. Provider HTTP codes, SQLSTATE values, socket errors, process IDs, and stack traces remain diagnostic detail, not the Product contract.

## 23. Observability architecture

Observability exists to answer:

- what logical Product work was attempted;
- what exact basis it used;
- which attempts/dispatches occurred;
- which route/capability actually executed;
- whether an accepted result exists;
- why retry/recovery happened;
- whether recovery changed user-visible availability;
- whether an outcome became ambiguous;
- whether stale/duplicate work was rejected;
- where time/budget was spent;
- whether a failure is systemic or isolated.

Observability must not become another authority store.

In particular, telemetry must not be the sole durable record that determines:

- whether a Run/task/capability operation succeeded;
- whether an accepted result exists;
- whether a retry is allowed or exhausted;
- whether an external action completed;
- whether USER authorization exists;
- whether a subject/object is deleted or inaccessible; or
- what Product state should be reconstructed after restart.

Those decisions are read from the owning durable Product stores/contracts. Observability may index, correlate, summarize, and diagnose them. Loss, delay, duplication, or rebuild of telemetry must not mutate Product meaning or recovery eligibility.

## 24. Diagnostic event envelope

Material reliability events should be structurally attributable. Conceptually:

```ts
interface ReliabilityEvent {
  eventId: string;
  occurredAt: string;
  eventType: string;

  subjectRef?: string;       // privacy-safe internal reference
  conversationId?: string;
  intentVersionId?: string;
  decisionPlanId?: string;
  runId?: string;
  runVersion?: number;
  logicalTaskId?: string;
  attemptId?: string;
  operationId?: string;

  capabilityId?: string;
  capabilityVersion?: string;
  requestedRouteRef?: string;
  actualRouteRef?: string;

  failureClass?: string;
  retryDisposition?: "NONE" | "RETRY_SCHEDULED" | "REUSED" | "BLOCKED" | "EXHAUSTED";
  userImpact?: "NONE" | "DEGRADED" | "VISIBLE_FAILURE" | "AMBIGUOUS_ACTION";

  durationMs?: number;
  attemptNumber?: number;
  maxAttempts?: number;
}
```

This is an illustrative envelope. Exact telemetry storage/transport may differ.

`retryDisposition` and `userImpact` are diagnostic projections of owning Product state at event time; they are not commands or canonical lifecycle fields. A consumer must not reconstruct authorization, accepted-result identity, retry permission, deletion state, or current Product-visible status from telemetry when the owning Product store is available.

## 25. Logging and privacy

Diagnostic usefulness does not authorize broad logging of user/provider content.

Logs/events should prefer:

- identifiers and hashes over full payloads;
- normalized error/failure classes;
- sizes/counts/durations;
- route/capability versions;
- state-transition outcomes;
- redacted source/provider metadata where needed.

They should avoid by default:

- full Conversation transcripts;
- raw USER secrets;
- provider credentials;
- full external response bodies;
- personal Resource payloads;
- generated artifacts;
- arbitrary tool arguments containing sensitive data.

Debug logging must respect the same subject/privacy/deletion boundaries as Product state where applicable.

## 26. Core reliability events

At minimum, instrumentation should be able to distinguish:

### API

- request accepted;
- idempotent replay reused;
- idempotency conflict;
- validation rejected;
- auth/ownership rejected;
- request latency/error class.

### Run

- Run created;
- phase/version transition;
- stale CAS rejected;
- cancellation requested/committed;
- Run completed/failed/cancelled;
- restart/resume reconstruction.

### Orchestration

- task scheduled;
- duplicate task suppressed/reused;
- attempt claimed;
- lease expired;
- attempt failed;
- retry scheduled;
- retry exhausted;
- result accepted;
- late/duplicate result rejected/existing reused.

### Capability/provider

- capability dispatch allowed/denied;
- requested route;
- actual route;
- provider attempt;
- provider normalized response/error;
- timeout/cancel;
- ambiguous completion;
- result size/budget rejection;
- binding changed after execution.

### V36

- research task accepted;
- evidence candidate produced;
- evidence admitted/rejected/insufficient;
- continuation requested;
- stale research result rejected.

### Continuity

- SSE/reconnect started;
- cursor/revision gap detected;
- durable refresh used;
- presentation/resource stale rejection.

## 27. Metrics

Metrics should aggregate Product-relevant reliability without exposing sensitive content.

Recommended dimensions include:

- API accepted/replayed/conflicted/invalid/auth-failed counts;
- Run active/terminal counts and phase durations;
- Run completion/cancellation/failure rates, with cancellation kept distinct from failure;
- stale CAS/rejected late-result counts;
- research queue depth;
- lease expiry count;
- attempts per logical task;
- retry exhaustion rate;
- accepted-result reuse/duplicate suppression count;
- provider success/429/5xx/timeout/malformed rates by qualified route version;
- capability cancellation/timeout/ambiguity counts;
- reconnect frequency and successful state-restoration rate;
- PostgreSQL connectivity/transaction failure class counts;
- Product-visible failure rate by stable failure class;
- recovery-in-progress/action-required/superseded counts separately from failure;
- recovery success rate by failure class;
- scoped degradation frequency/duration by affected capability/outcome.

Metrics do not prove Product correctness. They reveal where to investigate.

## 28. Correlation and provenance

A reliability trace should follow logical Product work across process boundaries without treating process-local request IDs as Product identity.

Preferred correlation chain:

```text
Conversation / IntentVersion
        |
DecisionPlan / Run
        |
logical task / operationId
        |
attemptId / dispatch correlation
        |
actual provider/tool route
        |
operational result
        |
V36 admission / StructuredDecision / Resource output
```

Operational correlation may be many-to-one relative to Product logical identity because retries create multiple attempts for one logical work item.

## 29. Failure escalation

Escalation is based on exhausted safe recovery, not raw severity labels alone.

Conceptually:

```text
fault detected
   |
   +--> deterministic/policy/stale? ----> fail/reject immediately
   |
   +--> transient and retry-safe? ------> bounded retry
   |                                      |
   |                                      +--> success -> internal recovery event
   |                                      +--> exhausted
   |
   +--> completion ambiguous? ----------> ambiguity recovery
   |
   +--> dependency alternative allowed? -> qualified degradation/fallback
                                          |
                                          +--> success -> degraded/recovered
                                          +--> unavailable

exhausted / ambiguous / unsafe continuation
   |
   v
Product-visible failure or action-required state
```

## 30. Failure budgets and backoff

Retries/backoff must be bounded by Product-owned budgets, such as:

- maximum attempts;
- maximum elapsed time;
- provider/capability call budget;
- token/input/output budget;
- network/egress budget;
- Run deadline where applicable.

Backoff/jitter are implementation details beneath the stable rule that retry does not become an unbounded autonomous loop.

A provider's retry suggestion may inform scheduling but does not override Product budgets or route policy.

## 31. Recovery after configuration/version change

Work started under one exact configuration/capability/provider/criterion version cannot silently resume under materially different semantics merely because the process restarted.

On recovery, the owner must determine whether:

- the exact prior contract remains executable;
- a qualified equivalent successor is permitted;
- the work must be superseded/replanned; or
- recovery is blocked pending new Product/user action.

A code deployment or branch change is not itself evidence that old durable work can safely execute under new semantics.

## 32. Resource and prepared-action recovery

Resource state follows the Resource and Action Architecture.

- deterministic Resource projections may be reconstructed;
- retained generated/retrieved Resource versions may be restored if still valid/relevant;
- stale Resource hydration fails explicitly;
- local unsent edits may be restored only where a qualified continuity contract exists;
- ActionProposal authorization binds the exact proposal version/digest;
- editing execution-significant fields invalidates prior authorization;
- ambiguous external action completion must not be represented as successful Resource/action state.

## 33. Deletion and late work

Deletion/subject-unavailability is a hard reliability boundary.

If deletion or subject inaccessibility occurs while work is running:

1. durable ownership state becomes authoritative;
2. new dispatch is denied;
3. best-effort cancellation may stop in-flight work;
4. late operational output is rejected from Product release;
5. Product-side Resource/caches/indexes follow deletion/purge policy;
6. provider-side retention remains governed by provider/privacy contract.

A late successful provider/tool response does not override deletion state.

## 34. What reliability must never do

Reliability logic must never:

- turn retries into multiple USER intent mutations;
- convert provider availability into truth authority;
- accept stale results into a new Run/IntentVersion;
- silently switch to an unqualified route;
- suppress material route provenance;
- classify timeout as proof of non-execution;
- resolve consequential-action ambiguity from non-authoritative telemetry/model inference;
- retry non-idempotent ambiguous external mutations blindly;
- bypass authorization because recovery is inconvenient;
- duplicate a logical research task merely because a worker restarted;
- manufacture a winner because evidence collection failed;
- serve stale actionable Resource data as current;
- expose raw infrastructure detail as user-facing Product semantics;
- claim recovery success without durable accepted state;
- use telemetry as the sole record of Product success, retry authority, authorization, or deletion state.

## 35. Current implementation alignment

Current canonical source already demonstrates substantial pieces of this architecture:

- durable asynchronous Runs and restartable coordination;
- PostgreSQL-backed orchestration state;
- logical research tasks with attempt counts, leases, maximum attempts, and accepted results;
- at-least-once worker assumptions with durable acceptance handling;
- exact Run/subject/IntentVersion capability binding;
- cancellation and timeout propagation;
- exact operation identity;
- successful capability-result reuse;
- explicit non-idempotent ambiguous-redispatch rejection;
- post-execution binding re-check before releasing a capability result;
- application-level idempotency behavior;
- reconnectable durable Product state and presentation reconstruction;
- V36 separation between operational research and factual admission.

These mechanisms should be reused rather than wrapped in a parallel reliability/orchestration subsystem.

## 36. Current implementation limitations

The permanent architecture is broader than current implementation. Current source does not yet establish every desired cross-system contract, including:

- one normalized reliability-event envelope across API/Run/orchestration/provider/V36/continuity;
- one stable Product-visible reliability-state contract across all APIs;
- complete explicit ambiguous-completion persistence for every future consequential action class;
- generalized scoped degradation representation by capability/outcome;
- complete provider/broker failover behavior across all qualified roles;
- long-horizon reliability SLOs/alerts;
- full operator diagnostics/runbook contract;
- production disaster-recovery/backup objectives.

Those are future implementation/design items; this document does not claim they already exist.

## 37. Migration direction

### Stage 1 — normalize failure classes and diagnostic identity

Adopt stable failure categories and exact logical-work/attempt/operation correlation across existing Runtime, capability, provider, continuity, and persistence surfaces.

### Stage 2 — close retry/ambiguity gaps

Audit every retry path against idempotency and ambiguous-completion semantics. Remove any retry behavior that lacks exact logical identity or safe redispatch proof.

### Stage 3 — Product-visible reliability contract

Normalize user-facing failure, recovery, action-required, cancellation, supersession, and scoped-degradation states while keeping provider/database/process errors internal.

### Stage 4 — reliability observability

Emit privacy-bounded structured reliability events and aggregate metrics for retry, leases, stale rejection, reconnect, ambiguity, provider failures, scoped degradation, and Product-visible failure.

### Stage 5 — integrated recovery acceptance

Validate restart/reconnect/provider/worker/PostgreSQL/adversarial journeys on exact revisions.

### Stage 6 — production reliability policy

Before 1.0 production readiness, separately qualify SLOs, backup/restore objectives, disaster-recovery targets, operational alerting, on-call/runbook expectations, and production failover policy.

## 38. Anti-collapse invariants

Future reliability work must preserve:

1. `logical work != attempt`.
2. `attempt retry != new semantic request`.
3. `worker process != task authority`.
4. `provider request != Run identity`.
5. `dispatch != completion`.
6. `timeout != proof of non-execution`.
7. `operational success != semantic admission`.
8. `recovery success != Product authority transfer`.
9. `duplicate delivery != duplicate logical work`.
10. `accepted result != latest arrival`.
11. `stale result != successor-state result`.
12. `cancellation signal != proof external work did not occur`.
13. `idempotent != consequence-free`.
14. `retryable != safe to retry without bounds`.
15. `provider fallback != permission to change semantics`.
16. `reconnect != client-state replay into authority`.
17. `SSE event stream != canonical state`.
18. `infrastructure failure != factual evidence`.
19. `provider failure != claim false`.
20. `scoped degraded operation != weakened authority standard`.
21. `degraded capability != degraded Product truth`.
22. `Resource cache != current Resource validity`.
23. `log/event != authority store`.
24. `diagnostic userImpact != canonical Product state`.
25. `high error severity != automatically user-visible failure`.
26. `successful hidden retry != requirement to expose infrastructure noise`.
27. `Product-visible failure != raw exception text`.
28. `cancellation/supersession/recovery-in-progress != automatically failure`.

## 39. Validation design

Future exact-revision probes should demonstrate at least:

1. duplicate API request with exact idempotency identity does not create duplicate logical work;
2. conflicting payload under reused idempotency identity fails explicitly;
3. duplicate orchestration wake-up creates no duplicate logical downstream task;
4. concurrent worker claims cannot produce two accepted logical results;
5. worker crash before commit recovers through lease/attempt semantics;
6. worker crash after external/provider completion but before commit follows operation idempotency/ambiguity rules;
7. API restart after durable acceptance preserves retrieval/reconnect;
8. orchestrator restart preserves Run/task progress;
9. PostgreSQL restart preserves committed Run/Conversation/research state;
10. stale Run epoch cannot commit;
11. superseded IntentVersion rejects late result;
12. deletion/subject change during operation blocks late release;
13. cancellation prevents new dispatch and rejects late current-state attachment;
14. provider unavailable before dispatch follows bounded retry/degradation policy;
15. provider 429/5xx follows bounded retry policy;
16. malformed provider output is not retried as transient unchanged contract failure unless route/input changes appropriately;
17. malformed tool proposal never executes;
18. timeout after possible non-idempotent completion enters ambiguity protection;
19. prior successful capability operation is reused for exact operation identity;
20. ambiguous non-idempotent operation cannot blindly redispatch;
21. ambiguous consequential completion cannot be resolved from telemetry/model inference absent authoritative external status or exact idempotency proof;
22. missing actual-route provenance prevents use where route provenance is required;
23. qualified fallback preserves exact Product role/basis and records actual route;
24. failed research execution does not become negative evidence;
25. V36 insufficiency remains semantic uncertainty rather than infrastructure success/failure fiction;
26. SSE disconnect/reconnect cannot regress durable Run/presentation state;
27. presentation/resource stale revision cannot overwrite current state;
28. Resource open/reconnect cannot resurrect stale actionable content;
29. exhausted required capability becomes Product-visible failure with stable Product semantics;
30. recovered transient worker/provider/database noise remains non-user-visible when Product outcome is preserved;
31. cancellation, supersession, and healthy recovery do not inflate Product failure classification;
32. scoped degradation identifies the affected capability/outcome and never weakens V36, Intent Authority, Decision Engine, subject isolation, provenance, or action authorization;
33. observability events correlate logical task/attempt/operation without logging prohibited payloads;
34. telemetry loss/rebuild cannot change accepted-result identity, retry permission, authorization, deletion state, or restart reconstruction;
35. exact-revision integrated Recovery and Adversarial journeys preserve Architecture Integrity.

Passing these probes establishes bounded reliability behavior for the exact tested revision and scope. It does not establish production readiness or disaster-recovery readiness.

## 40. Integrated recovery journeys

### Golden recovery journey

```text
USER request
→ durable Run accepted
→ research task claimed
→ worker restarts
→ lease expires/reclaim occurs
→ task completes
→ one result accepted
→ V36 admits qualified evidence
→ decision completes
→ client reconnects
→ newest durable Product state presented
```

Expected: no duplicate semantic work and no user-visible infrastructure failure if bounded recovery succeeds.

### Ambiguous external-operation journey

```text
exact ActionProposal + authorization
→ non-idempotent external dispatch
→ network/process failure after possible completion
→ outcome unknown
→ no blind redispatch
→ authoritative external-state/idempotency reconciliation or explicit action-required state
```

Expected: Lattice never reports failure as “definitely not executed” without authoritative evidence, never resolves ambiguity from telemetry/model inference alone, and never duplicates the action silently.

### Stale-work journey

```text
Run/IntentVersion A dispatches work
→ USER correction creates successor IntentVersion B
→ A work completes late
→ exact binding re-check rejects A result as current
→ B continues independently
```

Expected: availability does not override semantic freshness.

### Provider-degradation journey

```text
qualified provider route unavailable
→ affected capability/role marked degraded
→ bounded route policy evaluated
→ qualified equivalent route exists
→ actual route recorded
→ exact affected operation continues
```

or, if none exists:

```text
required capability unavailable
→ no unqualified fallback
→ Product-visible temporary unavailability / alternative next step
```

Expected: degradation remains scoped to the affected capability/outcome and does not imply reduced truth, subject, provenance, or authorization requirements elsewhere in the Product.

## 41. Observability acceptance questions

Before 1.0, an operator should be able to answer from privacy-safe Product telemetry:

- Is this Run making progress or repeatedly retrying the same fault?
- Did one logical task produce multiple attempts but only one accepted result?
- Which worker attempt currently owns a lease?
- Why was a late result rejected?
- Was a provider call retried, and why?
- Which provider/model/broker route actually handled the successful attempt?
- Is a failure transient, deterministic, stale, policy-denied, ambiguous, or exhausted?
- Did a reconnect restore from durable state or rely on stale local state?
- Is a user-visible failure caused by evidence insufficiency, capability unavailability, or infrastructure outage?
- Which capability/outcome is degraded, and which guarantees remain intact?
- Are retries approaching their budget limit?
- Are PostgreSQL/worker/provider faults localized or systemic?
- Did any consequential action enter ambiguous completion?

If answering those questions requires reading raw user/provider payloads by default, the observability design is too content-dependent.

If Product recovery would become impossible merely because telemetry was lost, the observability design has crossed into an unauthorized durability/authority role.

## 42. Structural summary

```text
                    authoritative Product basis
                              |
                              v
                     durable logical work
                              |
                +-------------+-------------+
                |                           |
                v                           v
          execution attempt            reconnect/read
                |                           |
        +-------+--------+                  |
        |                |                  |
        v                v                  |
     success           failure              |
        |                |                  |
        |      +---------+----------+       |
        |      |                    |       |
        |      v                    v       |
        |  deterministic/      transient/retry-safe
        |  stale/policy             |
        |      |                    v
        |      |               bounded retry
        |      |                    |
        |      |          +---------+---------+
        |      |          |                   |
        |      |          v                   v
        |      |       recovered          exhausted/
        |      |                           ambiguous
        |      |                              |
        +------+------------------------------+
                              |
                              v
                   durable acceptance/state
                              |
                 +------------+-------------+
                 |                          |
                 v                          v
        infrastructure event        Product-visible state
        / metric / diagnostic       only when materially needed
```

The permanent ownership rule is:

> **Reliability preserves exact Product work across unreliable execution surfaces. Recovery may replace attempts, workers, connections, and qualified execution routes; it may not replace Product meaning, authority, provenance, or required authorization.**

## 43. Draft status and next use

This document is a reconciled Owner-directed draft against canonical `main @ f56d004e73f7b3cfc93f1a2aaa0571c763689898`.

It generalizes the restart/retry/idempotency/reconnect/provider/worker/PostgreSQL failure surface already exposed by current implementation and M9 into a permanent cross-system architecture.

Dedicated reconciliation corrected four semantic risks in the first draft:

1. reliability-relevant lifecycle states are no longer all classified as failures;
2. degradation is scoped to an affected capability/outcome rather than treated as a vague Product-wide mode;
3. consequential-action ambiguity can be resolved only by authoritative external status/exact idempotency evidence or a qualified recovery path, not by telemetry/model inference; and
4. observability is explicitly prevented from becoming the sole durability source for recovery, authorization, accepted results, or deletion state.

The important permanent Product commitments proposed here are:

1. failure recovery occurs at the lowest owner that can preserve exact Product meaning;
2. logical work identity is separate from attempts/processes/provider requests;
3. at-least-once delivery is compatible with logically-once durable acceptance;
4. deterministic/stale/policy failures are not retried unchanged;
5. non-idempotent ambiguous completion is a first-class fail-closed state;
6. retries/fallback never reset budgets or weaken route/provenance/authority requirements;
7. reconnect reconstructs from durable Product state rather than trusting stale client state;
8. scoped degraded operation is allowed only when semantic and authorization standards remain intact and the lost capability is explicit;
9. Product-visible failure is based on user-impact/safe-continuation semantics, not raw infrastructure errors or normal cancellation/supersession/recovery states; and
10. privacy-bounded structured observability must correlate logical work, attempts, routes, recovery, and user impact without becoming an authority or recovery store.

This draft changes no runtime behavior, persistence schema, provider configuration, production infrastructure, production data, secrets, billing, or consequential external action.