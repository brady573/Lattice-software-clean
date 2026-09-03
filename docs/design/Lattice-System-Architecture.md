# Lattice System Architecture

Status: **Owner-approved current implementation structural map**.

Approved: **August 31, 2026**.

Repository reconciliation baseline: merged foundational repair on `main @ 3de31612c46a3e31a70e6977f6e100d20bb6be85`. Later validation claims remain bound to their exact candidate SHA.

## 1. Purpose

This document is the concise structural map of the current Lattice implementation. A new engineer should read it before opening source.

It answers:

- what the canonical Product subsystems are;
- what each subsystem owns and does not own;
- which components compose those subsystems at runtime;
- what calls what;
- which state is authoritative, durable, or derived;
- where the major trust and authority boundaries are; and
- how Intent Authority, Run, V36 Truth Core, conditional decision work, Action Preparation, and Solandra compose without collapsing their authority boundaries.

This document does **not** replace the **Lattice Living Product Design**. The living design remains the canonical forward-looking Product design and sequencing source. This document instead describes the current implementation structure at a specific repository baseline.

It also does not replace:

- `The-Core-Lattice-Philosophy.md`, which is the highest Product-design authority and first filter;
- `Lattice-Foundational-Design-Principle.md`, which elaborates that philosophy as a subordinate Product-design filter;
- `Lattice-Architecture-Integrity.md`, which protects cross-cutting semantic ownership and authority boundaries;
- `Lattice-System-Registry-and-Naming.md`, which defines canonical system names; or
- the protected V36 specifications, which remain controlling for V36 epistemic semantics.

## 2. System at a glance

The current Product is deliberately separated into semantic authorities, operational runtime, capability boundaries, and presentation. Decision machinery is conditional:

```text
Knowledge:
IntentVersion -> Run -> V36 -> KnowledgeOutcome -> Solandra

Action Preparation without decision:
IntentVersion -> Run -> V36 -> Resource -> Solandra Composer

Qualified decision:
IntentVersion -> DecisionPlan -> Run -> V36
              -> decision evidence projection
              -> Decision Engine -> DecisionSupportOutcome -> Solandra
```

The first two paths have no DecisionPlan and never enter the Decision Engine. All three start from the same conversation intake, Intent Authority, Run, and V36 architecture; scenario input and qualified adapters vary, not the core Product or primary UI.

The **Lattice Model Gateway** sits beside this flow as a non-authoritative capability boundary. Product subsystems may invoke it where qualified designs permit model assistance. Model/provider output remains proposal, interpretation, or rendering material until the owning Product authority accepts it under its own contract.

The central architectural rule is:

> **Moving information through a component does not transfer semantic authority to that component.**

A model does not own intent because it interprets language. A Run does not own truth because it coordinates research. V36 does not choose a winner because it validates evidence. Solandra does not own the decision because it presents it. Persistence does not become semantic authority because it stores the bytes.

## 3. Canonical Product subsystems

### 3.1 Lattice Intent Authority

**Primary implementation:** `src/intent/`

**Owns:**

- canonical structured USER intent;
- `IntentScope` and versioned `IntentVersion` state;
- USER-supported intent changes;
- clarification state;
- correction and supersession lineage;
- source-message provenance;
- exact `intentVersionId` identity; and
- explicit reusable USER preferences where qualified.

**Does not own:**

- external factual truth;
- Run lifecycle;
- eligibility or ranking;
- winner selection; or
- presentation authority.

Representative implementation surfaces:

```text
src/intent/types.ts
src/intent/store.ts
src/intent/postgres-store.ts
src/intent/reducer.ts
src/intent/source-message-store.ts
src/intent/run-binding.ts
src/intent/postgres-run-binding-store.ts
src/intent/generalized-decision-semantics.ts
src/intent/generalized-decision-planning.ts
src/intent/user-preference-store.ts
```

The transcript is context and provenance, not the canonical decision input. Material corrections create or identify a new authoritative intent version rather than silently changing the meaning of a Run already bound to an older version.

### 3.2 Lattice Execution Runtime

**Primary implementation surfaces:**

```text
src/runtime-app.ts
src/run-store.ts
src/postgres-run-store.ts
src/api-control-store.ts
src/postgres-api-control-store.ts
src/run-execution.ts
src/run-worker.ts
src/run-worker-process.ts
src/orchestration-store.ts
src/postgres-orchestration-store.ts
src/research-worker.ts
src/research-worker-process.ts
```

**Owns:**

- durable Run lifecycle;
- Run status/version and compare-and-swap transition ownership;
- dispatch and orchestration;
- cancellation and supersession;
- retry/recovery coordination;
- public Run events;
- durable research scheduling and work execution; and
- operational continuation state.

**Does not own:**

- external factual truth;
- USER intent semantics;
- decision semantics; or
- presentation authority.

The Execution Runtime answers **what Lattice is doing operationally**, not whether a claim is true or which candidate should win.

### 3.3 Lattice Model Gateway

**Primary implementation:** `src/model/`

**Owns:**

- provider-neutral request/response contracts;
- model capability negotiation;
- bounded/cancellable invocation;
- context projection;
- provider adapter isolation; and
- invocation provenance.

**Does not own:**

- USER intent;
- V36 truth;
- authoritative decisions;
- Product validation; or
- production authority.

Representative surfaces:

```text
src/model/provider.ts
src/model/runtime.ts
src/model/types.ts
src/model/context-projection.ts
src/model/canonical.ts
src/model/openai-compatible.ts
src/model/local-offline-runtime.ts
src/model/android-relay.ts
```

The current local Qwen/Ollama path is a qualified local/offline development capability. That qualification does not promote provider output into intent, truth, decision, or production authority.

### 3.4 V36 Truth Core

**Primary implementation:** `src/truth/`

**Owns:**

- external factual truth/evidence state;
- evidence qualification and admission;
- source and provenance relationships;
- claims and contradiction;
- corroboration and falsification;
- proof status;
- factual assessments;
- temporal applicability;
- epistemic confidence; and
- validated truth snapshots.

**Does not own:**

- USER preference weights;
- hard-requirement meaning;
- operational scheduling;
- winner selection; or
- human-facing explanation.

Representative surfaces:

```text
src/truth/admission.ts
src/truth/adjudication.ts
src/truth/claim-compiler.ts
src/truth/corroboration.ts
src/truth/falsification.ts
src/truth/pipeline.ts
src/truth/execution-pipeline.ts
src/truth/decision-evidence-provider.ts
src/truth/durable-validation.ts
src/truth/provenance.ts
src/truth/research-controller.ts
src/truth/research-enrichment.ts
src/truth/snapshot.ts
src/truth/runtime-handoff.ts
```

V36 alone decides whether research/provider material is admissible into protected truth state. Successful retrieval, model output, worker completion, or provider availability cannot strengthen truth by themselves.

### 3.5 Lattice Decision Engine

**Primary implementation:** `src/engine.ts` and `src/decision/`

**Owns:**

- hard-constraint evaluation;
- eligibility;
- qualified preference comparison and coverage;
- meaningful-difference semantics;
- material-dominance/frontier semantics;
- delegated selection where authorized;
- tie/outcome semantics; and
- authoritative `StructuredDecision` output.

**Does not own:**

- external truth admission;
- USER-intent mutation;
- Run scheduling; or
- presentation authority.

Representative surfaces:

```text
src/engine.ts
src/decision/criterion-catalog.ts
src/decision/decision-input-snapshot.ts
src/decision/priority-and-requirements.ts
src/decision/preference-coverage.ts
src/decision/meaningful-difference.ts
src/decision/material-dominance-frontier.ts
src/decision/delegated-selection.ts
```

The Decision Engine consumes authoritative decision planning material plus a decision-specific projection of V36-admitted evidence. It cannot strengthen evidence merely to make a candidate eligible or more attractive, and it does not add raw values from incompatible criterion scales.

### 3.6 Solandra Experience

**Primary implementation surfaces:**

```text
src/presentation/
src/conversation/
src/ui/
```

**Owns:**

- conversation UX;
- clarification presentation;
- progress presentation;
- current-understanding presentation;
- explanation;
- semantic presentation projection;
- evidence/uncertainty presentation;
- action-supporting resources; and
- continuation/reconnection experience.

**Does not own:**

- canonical intent mutation;
- external truth;
- eligibility or ranking; or
- winner authority.

Solandra is intentionally downstream of the authoritative Product state it presents. Generated prose and UI state may explain or organize that state but may not silently create or change it.

## 4. DecisionPlan: durable binding, not a new authority

**Primary implementation:** `src/intent/decision-plan-store.ts`

A **DecisionPlan is not a peer Product authority or subsystem**. It exists only for actual authoritative decision work and durably joins one exact `IntentVersion` to one exact `DecisionInputSnapshot` executed by one Run. Knowledge and non-decision Action Preparation Runs do not have DecisionPlans.

Conceptually:

```text
IntentVersion
     |
     | faithful planning projection
     v
DecisionPlan
     |
     | exact DecisionInputSnapshot
     v
Run
```

A current DecisionPlan records:

```text
decisionPlanId
runId
intentScopeId
intentVersionId
planningMaterial
boundAt
```

The DecisionPlan store requires the referenced IntentVersion to exist in the requested IntentScope and validates the complete execution-significant projection: objective, requirements, preferences, exact criterion bindings, and intent basis identifiers. The snapshot carries its catalog basis; execution rebuilds the projection against the qualified catalog and requires exact equality. Broad field counts are not fidelity. Reusing the same Run identity with different planning material is rejected.

The ownership rule is therefore:

> **Intent Authority owns USER meaning. DecisionPlan freezes the exact planning projection of that meaning for a particular Run.**

This prevents later conversation changes or intent corrections from silently rewriting the meaning of an already-created Run.

In PostgreSQL mode the binding is durable. In memory mode the same contract is enforced for the process lifetime.

## 5. Run: durable operational composition envelope

A **Run** is the durable operational envelope through which the Product authorities compose.

It contains or references state such as:

```text
Run
 |
 +-- request ------------> exact IntentVersion-bound consultation request
 +-- decision input -----> present only when bound through DecisionPlan
 +-- status/version -----> Execution Runtime authority
 +-- truth snapshot -----> V36-produced epistemic state
 +-- decision -----------> Decision Engine output
 +-- explanation --------> Solandra presentation output
 +-- events -------------> progress/continuity state
```

Persistence of another subsystem's output inside a Run does not transfer semantic ownership to the Runtime.

For example:

- a persisted truth snapshot is still V36 truth;
- a persisted `StructuredDecision` is still Decision Engine output; and
- a persisted explanation remains Solandra presentation.

The shared truth progression is structurally:

```text
CREATED
  |
  v
UNDERSTANDING
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
  +--> COMPLETED (Knowledge or Action Preparation)
  |
  +--> DECIDING --> COMPLETED (qualified decision work only)
```

`AWAITING_CLARIFICATION`, `CANCELLED`, and `FAILED` represent waiting or terminal states where applicable.

## 6. V36 execution and research continuation

During Run execution, V36 is invoked through an explicit truth-pipeline contract.

The structural flow is:

```text
INVESTIGATING
     |
     | truthPipeline.investigate(runId)
     v
INVESTIGATED TruthSnapshot
     |
     | persisted by RunStore
     v
VALIDATING
     |
     | truthPipeline.validate(...)
     | or durable begin/resume validation
     v
VALIDATED TruthSnapshot
     |
     | persisted by RunStore
     v
COMPLETED or, only for a qualified decision, DECIDING
```

The current default truth pipeline remains an offline-fixture execution seam. The architectural contract is nonetheless explicit and is the boundary through which later qualified live research must pass.

When V36 requires additional research, authority remains split deliberately:

```text
V36
 |
 | NEEDS_RESEARCH checkpoint + requests
 v
Execution Runtime
 |
 | durable scheduling / operational work
 v
Research worker / provider boundary
 |
 | opaque results
 v
Execution Runtime
 |
 | exact continuation handoff
 v
V36
 |
 | admit / reject / request more / validate
 v
protected truth state
```

The Runtime owns operational execution. V36 owns epistemic admission and sufficiency. The research/provider boundary cannot self-promote its output into truth.

## 7. Decision composition

Only during qualified `DECIDING`, the current execution path:

1. reloads the persisted `VALIDATED` V36 snapshot;
2. invokes a decision-specific evidence provider to project candidate/criterion evidence from that validated state;
3. materializes only admitted decision evidence;
4. invokes the Lattice Decision Engine with the exact DecisionPlan snapshot;
5. checks decision-to-truth fidelity;
6. persists the resulting `StructuredDecision`; and
7. creates a faithful Solandra explanation from the authoritative decision and truth state.

The authority relationship is:

```text
DecisionPlan / DecisionInputSnapshot
        |
        +----------+
                   |
                   v
             Decision Engine
                   ^
                   |
        +----------+
        |
Decision-specific projection of validated V36 evidence
```

The resulting `StructuredDecision` belongs to the Decision Engine even though the Runtime persists it and Solandra presents it.

## 8. Solandra semantic presentation

The current semantic presentation layer is primarily a **derived projection** of authoritative Product state.

`src/presentation/solandra-presentation.ts` derives a `SolandraPresentationSnapshot` from current basis identifiers such as:

```text
conversationId
runId
runVersion
decisionPlanId
intentVersionId
```

It may derive:

```text
semantic phase
current durable understanding
material uncertainty
supporting knowledge
next action
resource descriptors
presentation revision
```

Examples of the dependency direction:

- durable understanding derives from the accepted IntentVersion, whether or not decision work exists;
- progress/knowledge-gap state derives from the Run;
- recommendation derives from the persisted `StructuredDecision`;
- evidence provenance refers back to V36 assessments; and
- resources are licensed projections over those authoritative bases.

The rule is:

> **Solandra presentation state should be derived where possible instead of becoming another mutable copy of intent, truth, or decision authority.**

## 9. Conversation and continuity

**Primary implementation:** `src/conversation/`

Conversation infrastructure supplies durable interaction and reconstruction around the canonical authorities.

Representative surfaces:

```text
src/conversation/conversation-store.ts
src/conversation/conversation-api.ts
src/conversation/continuity-api.ts
src/conversation/conversation-membership-guard.ts
src/conversation/run-index-store.ts
src/conversation/run-index-control.ts
src/conversation/user-message-history.ts
```

Conversation state answers operational and continuity questions such as:

- which conversation is active;
- which messages belong to it;
- which Runs belong to it;
- what should be reconstructed after reconnect;
- which DecisionPlan corresponds to a Run; and
- whether the authenticated subject may access the graph.

Conversation persistence does not make transcript text authoritative intent.

```text
Conversation / USER messages
          |
          | context + provenance
          v
Lattice Intent Authority
          |
          | accepted structured meaning
          v
IntentVersion
```

## 10. Authentication and subject boundary

**Primary implementation:** `src/auth/authenticated-subject.ts` and `src/runtime-app.ts`

The authenticated-subject boundary establishes who may access subject-scoped Product state. It is used by authoritative APIs and continuity surfaces to enforce ownership and non-disclosing cross-subject isolation.

Authentication answers **who may access** a state graph. It does not establish:

- what the USER means;
- whether evidence is true; or
- which candidate should win.

Development fixture identity is restricted to development mode. Durable/non-development composition fails closed without an injected authenticated-subject resolver.

## 11. Runtime composition root

`src/runtime-app.ts` is the principal application composition root.

It wires together:

```text
AuthenticatedSubjectResolver
ConversationStore
IntentAuthorityStore
IntentUserMessageStore
UserPreferenceStore
DecisionPlanStore
RunStore
ApiRunControlStore
ConversationRunIndexStore
TruthExecutionPipeline
DecisionEvidenceProvider (injected only for qualified decision work)
optional ModelRuntime
HTTP/API surfaces
```

The runtime supports memory and PostgreSQL adapters behind the same semantic contracts.

### 11.1 In-memory development composition

Representative adapters:

```text
MemoryConversationStore
MemoryIntentAuthorityStore
MemoryIntentUserMessageStore
MemoryUserPreferenceStore
MemoryDecisionPlanStore
MemoryRunStore
MemoryConversationRunIndexStore
MemoryApiRunControlStore
```

This mode preserves the subsystem contracts but is process-local.

### 11.2 PostgreSQL durable composition

Representative adapters:

```text
PostgresConversationStore
PostgresIntentAuthorityStore
PostgresIntentUserMessageStore
PostgresUserPreferenceStore
PostgresDecisionPlanStore
PostgresRunStore
PostgresConversationRunIndexStore
PostgresApiRunControlStore
PostgresOrchestrationStore
PostgresV36ResearchBridge
```

PostgreSQL is the principal durable storage boundary for the current server runtime. Storage adapters persist state owned by their subsystem contracts; the database is not a new Product-semantic authority.

## 12. Run submission composition

Current Run submission deliberately layers binding and indexing around the base Run-control store:

```text
Intent-aware intake
       |
       v
Run + exact intent binding
       |
       v
DecisionPlanRecordingApiRunControlStore
       |
       | persist an exact DecisionPlan only for qualified decision work
       v
ConversationRunIndexRecordingApiRunControlStore
       |
       | associate Run with conversation continuity
       v
ApiRunControlStore
       |
       | persist / dispatch Run
       v
Execution Runtime
```

This ordering makes the exact intent/planning basis durable before the underlying Run submission is accepted.

## 13. End-to-end composition

The current Product has three outcome paths through the same intake and truth architecture:

```text
1. USER CONVERSATION
       |
       v
2. LATTICE INTENT AUTHORITY
   accepts supported structured meaning
       |
       v
   IntentVersion
       |
       v
3. RUN / EXECUTION RUNTIME
       |
       +--> UNDERSTANDING
       |
       +--> PLANNING
       |
       +--> INVESTIGATING --> V36
       |
       +--> VALIDATING -----> V36
       |                         |
       |                 VALIDATED TruthSnapshot
       |                         |
       +<------------------------+
       |
       +--> COMPLETED ------> KnowledgeOutcome or ActionPreparation
       |
       +--> DECIDING (qualified decision work only)
               |
               | exact DecisionPlan + decision evidence projection
               v
          DECISION ENGINE
               |
               v
        StructuredDecision
               |
               v
           SOLANDRA
               |
               v
      explanation / current state
               |
               v
              USER
```

Compactly:

```text
IntentVersion
   |
   v
Run
   |
   v
V36 Truth Core
   +--> KnowledgeOutcome
   +--> ActionPreparation
   +--> [DecisionPlan required] Decision Engine --> DecisionSupportOutcome
   |
   v
Solandra Experience
```

## 14. Authoritative, durable, and derived state

### 14.1 Canonical semantic authority

| State | Semantic owner |
|---|---|
| Structured USER intent and IntentVersion lineage | Lattice Intent Authority |
| Run lifecycle and execution state | Lattice Execution Runtime |
| External factual claims, evidence, assessments, proof state | V36 Truth Core |
| Qualified decision eligibility, comparison, frontier, licensed selection, `StructuredDecision` | Lattice Decision Engine |
| Human-facing explanation and semantic presentation | Solandra Experience |

### 14.2 Durable binding and coordination state

The following may be durable and materially important, but they do not become new semantic authorities:

| State | Role |
|---|---|
| DecisionPlan | Exact IntentVersion → DecisionInputSnapshot binding for a qualified decision Run |
| Run-intent binding | Preserves the authoritative intent identity used by a Run |
| Conversation Run index | Associates Runs with conversation continuity |
| API idempotency state | Prevents duplicate operational effects within its scope |
| Dispatch/outbox state | Coordinates execution |
| Research continuation checkpoints | Resumable V36/Runtime handoff state |
| Conversation ownership/deletion state | Access and lifecycle boundary |

### 14.3 Derived state

Prefer derived state where it can be faithfully reconstructed from authoritative durable inputs.

Current examples include:

- accepted-understanding presentation derived only from the authoritative IntentVersion;
- supporting knowledge derived from V36 truth state and applicable outcome state, never from planning material alone;
- next-action presentation derived from an applicable prepared Resource or qualified DecisionSupportOutcome, not a universal `StructuredDecision`;
- presentation revision derived from its authoritative basis;
- meaningful-difference and frontier state derived from qualified criterion semantics and admitted evidence; and
- UI/progress projections derived from Run lifecycle.

The general rule is:

> **Do not create another mutable authority when a faithful projection can be derived from an existing one.**

## 15. Major authority and trust boundaries

### A. Conversation → Intent Authority

```text
transcript / model interpretation
              !=
      canonical IntentVersion
```

Conversation and model material may propose meaning. Intent Authority owns the accepted canonical USER state.

### B. Intent Authority → DecisionPlan

```text
current mutable conversation context
              !=
      already-bound Run meaning
```

When decision work is qualified, DecisionPlan freezes one exact intent version and faithful decision projection for one Run. Later changes do not rewrite historical bindings. When decision work is absent, no DecisionPlan is created.

### C. Execution Runtime → V36

```text
successful retrieval / research / worker completion
                      !=
             admitted factual truth
```

Operational capability cannot become epistemic authority.

### D. Model Gateway → Product authorities

```text
model/provider output
          !=
intent / truth / decision
```

The calling Product authority remains responsible for accepting or rejecting model material under its own contract.

### E. V36 → Decision Engine

```text
truth != decision
```

V36 establishes generic factual/evidence state. Only when decision work is qualified does a decision-specific projection adapt admitted evidence for the Decision Engine, which applies authoritative requirements and qualified comparison semantics.

### F. Decision Engine → Solandra

```text
explanation != decision creation
```

Solandra may explain, challenge, contextualize, and present. It may not silently change eligibility, frontier membership, ranking, or winner identity.

### G. Authentication → semantic state

```text
identity / access permission
          !=
intent / truth / decision authority
```

Authentication controls access, not meaning.

### H. Persistence → semantic owner

```text
database ownership of bytes
          !=
Product-semantic ownership
```

Storage location does not transfer authority.

## 16. Dependency direction

The intended semantic dependency direction is:

```text
Lattice Intent Authority
      |
      v
Lattice Execution Runtime
      |
      +--------------------+
      |                    |
      v                    v
V36 Truth Core       Lattice Model Gateway
      |
      +--> Knowledge / Action Preparation
      |
      +--> conditional DecisionPlan + Decision Engine
      |
      v
Solandra Experience
```

Conversation, progress, authentication, persistence adapters, workers, and APIs support this flow without acquiring independent semantic authority.

Cross-layer shortcuts that bypass these contracts should be treated as architecture defects unless an explicit qualified Product design establishes otherwise.

## 17. Current implementation limits

This map describes current structure, not every final 1.0 capability.

At the reconciliation baseline:

- the default V36 `TruthExecutionPipeline` remains an offline-fixture execution seam and produces truth state without a candidate-shaped generic contract;
- local/offline model capability exists through the Model Gateway and remains non-authoritative;
- M9 live-provider promotion remains separately qualified work and does not follow from local-model support;
- Solandra can present accepted intent and pending clarification before terminal Run completion; partial V36 findings are not yet exposed as a streaming presentation contract and are not fabricated;
- PostgreSQL provides durable adapters for the current continuity, intent, planning, Run, truth, orchestration, and preference surfaces; and
- production deployment/readiness is not implied by this structural map.

A future implementation may replace an adapter, provider, persistence topology, worker arrangement, or UI implementation without changing this architecture.

A change that moves semantic ownership among Intent Authority, Execution Runtime, Model Gateway, V36, Decision Engine, or Solandra is a material Product architecture change and must be explicitly qualified rather than inferred from code movement.

## 18. Reading order for new engineers

After this document, read according to the change being made.

### Product philosophy and long-term direction

```text
docs/design/The-Core-Lattice-Philosophy.md
docs/design/Lattice-Foundational-Design-Principle.md
docs/design/Lattice-Living-Software-Design-to-1.0.md
```

### Authority boundaries and canonical naming

```text
docs/design/Lattice-Architecture-Integrity.md
docs/design/Lattice-System-Registry-and-Naming.md
```

### Intent and planning

```text
src/intent/types.ts
src/intent/store.ts
src/intent/reducer.ts
src/intent/decision-plan-store.ts
```

### Runtime and Run lifecycle

```text
src/runtime-app.ts
src/run-store.ts
src/run-execution.ts
```

### V36

```text
docs/specifications/V36-Truth-Layer/
src/truth/execution-pipeline.ts
src/truth/snapshot.ts
src/truth/admission.ts
```

### Decision

```text
src/engine.ts
src/decision/
```

### Solandra and continuity

```text
src/presentation/solandra-presentation.ts
src/presentation/solandra/
src/conversation/
src/ui/
```

### Model capability

```text
src/model/provider.ts
src/model/runtime.ts
src/model/context-projection.ts
```

## 19. Structural invariant

The current architecture can be summarized as:

```text
Intent Authority   = what the USER means
DecisionPlan       = the exact planning contract for a qualified decision Run only
Execution Runtime  = what Lattice is doing
V36 Truth Core     = what Lattice can support as factual truth
Decision Engine    = what follows from intent + admitted evidence
Solandra Experience = how that Product state is understood and used by the USER
Model Gateway      = non-authoritative model capability available to Product systems
```

The Product-level invariant is:

> **Lattice separates what the USER means, what is true, what the system is doing, what should be chosen, and how that result is communicated. Those responsibilities compose, but they do not collapse.**
