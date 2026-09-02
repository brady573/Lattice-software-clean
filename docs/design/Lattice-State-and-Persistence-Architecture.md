# Lattice State, Persistence, and Lifecycle Architecture

Status: **RECONCILED DRAFT — Owner-directed cross-system architecture**

Drafted: **August 31, 2026**

Repository reconciliation baseline: `main @ 648bcc7241d6827736fbce6e2c52524465f086da`, tree `e32dd9288055fc54f81a9c0e1b4bcc491071fe04`.

## 1. Purpose

Lattice now has enough durable Product state that persistence itself needs an explicit cross-system architecture.

This document defines lifecycle, ownership, persistence, reconstruction, invalidation, deletion, and purge behavior across the durable decision graph:

```text
Conversation
  -> USER Message / provenance
  -> IntentScope / IntentVersion
  -> DecisionPlan
  -> Run
  -> operational results / continuation checkpoints
  -> V36 evidence / truth checkpoints
  -> StructuredDecision
  -> Solandra presentation projection
```

The core rule is:

> **Persistence preserves state; it does not transfer semantic authority.**

A row, event, cache entry, snapshot, checkpoint, serialized response, process boundary, or storage location does not become authoritative merely because it is durable.

## 2. Authority and relationship to other design sources

This document is a cross-system state architecture. It does not replace or reinterpret the more-specific Product authorities that define subsystem semantics.

It must remain consistent with, and is subordinate at their applicable boundaries to:

- `Lattice-Foundational-Design-Principle.md` — first Product-design filter;
- `Lattice-Living-Software-Design-to-1.0.md` plus confirmed amendments — canonical forward Product direction;
- `Lattice-Owner-Decisions-OD-001-to-OD-004.md` and the v0.6 amendment — confirmed Intent Authority, V36 continuation, Decision Engine, and Solandra boundaries;
- `Lattice-Owner-Decision-OD-007-M8-Continuity.md` and the v0.7 amendment — continuity, ownership, deletion, and retention direction;
- `Lattice-Architecture-Integrity.md` — protected cross-cutting semantic ownership;
- `Lattice-System-Registry-and-Naming.md` — canonical subsystem names and ownership vocabulary;
- `Lattice-System-Architecture.md` — current implementation structural map;
- protected V36 specifications — controlling epistemic semantics; and
- `docs/implementation/WI-1-solandra-semantic-presentation.md` — current reconstructed-presentation implementation boundary.

If a future subsystem-specific qualified design changes one of these semantics, this cross-system document must be reconciled rather than treated as authority to override that design.

Where current implementation is narrower than this architecture, this document describes the required ownership/lifecycle rule without claiming the missing mechanism is already implemented.

## 3. Design objective

The persistence architecture should make these properties true at the same time:

1. every material Product concept has exactly one semantic owner;
2. durable state survives restart without reconstructing canonical meaning from lossy prose;
3. immutable historical state remains historical when newer state supersedes it;
4. mutable operational state changes only through the owning lifecycle contract and explicit version/epoch checks;
5. idempotent replay cannot create divergent durable meaning;
6. reconnect reconstructs Product state from canonical durable records and exact bindings;
7. stale work cannot overwrite newer state;
8. deletion immediately removes normal user-facing access to the owned graph;
9. later physical purge removes or irreversibly severs purge-eligible user-data-bearing state according to separately qualified policy; and
10. presentation state, summaries, caches, indexes, and convenience projections never become second semantic authorities.

## 4. State classes

Lattice durable state falls into four architectural classes.

### 4.1 Canonical semantic state

Canonical semantic state is the authoritative representation of a Product concept owned by the subsystem that defines its meaning.

Examples include:

- `IntentVersion` under **Lattice Intent Authority**;
- admitted V36 evidence/truth state under **V36 Truth Core**; and
- `StructuredDecision` under the **Lattice Decision Engine**.

Canonical semantic state may be immutable, versioned, or checkpointed, but another subsystem may not independently rewrite its meaning.

### 4.2 Durable operational state

Durable operational state records what **Lattice Execution Runtime** must know to coordinate work across retries, workers, restart, cancellation, reconnect, and recovery.

Examples include:

- Run lifecycle status/version;
- dispatch/outbox state;
- cancellation and supersession state;
- durable research scheduling/results;
- V36 continuation transport/checkpoint delivery state; and
- exact DecisionPlan-to-Run association.

Operational durability may persist outputs owned by another subsystem, but the embedded values retain their original semantic owners.

### 4.3 Durable provenance, identity, and ownership state

Some records exist primarily to prove identity, lineage, authorization, exact source binding, or replay identity.

Examples include:

- Conversation owner subject;
- USER-message IDs, digests, logical turn identity, and message horizon;
- IntentVersion predecessor/lineage metadata;
- DecisionPlan exact `intentVersionId` binding;
- V36 source/provenance relationships; and
- request hashes used for idempotency.

These records constrain interpretation. They do not independently create intent, truth, or decision semantics.

### 4.4 Derived / reconstructible state

Derived state is computed from canonical or durable state and must not silently become an independently mutable authority.

Examples include:

- Solandra semantic presentation snapshots;
- `presentationRevision`;
- progress summaries;
- continuity response documents;
- convenience indexes;
- hydrated presentation resources;
- UI open/closed resource state; and
- cached human-readable renderings that are reproducible from an exact basis.

Derived state may be cached for performance only when its authoritative basis is retained and staleness is mechanically detectable.

## 5. Canonical durable graph

Conversation is the ownership/access root for the durable interaction graph established by M7/M8. Semantic authority still remains distributed across the canonical Product systems.

```text
AuthenticatedSubject
        |
        | owns
        v
Conversation
        |
        +--> USER Message / provenance
        |       |
        |       | exact source binding
        |       v
        |   Lattice Intent Authority
        |   IntentScope -> IntentVersion(s)
        |                    |
        |                    | faithful exact planning projection
        |                    v
        |               DecisionPlan
        |                    |
        |                    | exact Run binding
        |                    v
        +------------------> Run
                             |
                             +--> operational lifecycle / events
                             +--> durable V36 continuation transport
                             +--> V36 truth checkpoints / admitted evidence
                             +--> StructuredDecision
                             +--> persisted renderings where currently required
                             |
                             v
                   reconstructed Solandra presentation
```

This is a composition graph, not an authority-transfer graph.

## 6. Lifecycle and ownership by record

### 6.1 Conversation

**Role:** durable ownership and continuity root for a user interaction graph.

**Owned meaning:** identity, authenticated ownership, creation, deletion/access state, and graph anchoring.

**Does not own:** USER intent, V36 truth, Decision Engine semantics, or Solandra presentation meaning.

Conceptual durable fields:

```text
conversationId
ownerSubjectId
createdAt
deletedAt?
```

**Mutability:**

- identity, owner, and creation identity are immutable;
- deletion state may move from active to deleted;
- normal Product paths must not silently reactivate a deleted Conversation.

**Lifecycle:**

```text
ACTIVE -> DELETED / inaccessible -> PURGED
```

`DELETED` is an access/lifecycle state, not proof that every retained physical record has already been erased.

### 6.2 USER Message and USER provenance

**Role:** durable USER-authored transcript/provenance material used by Intent Authority.

**Semantic/provenance owner:** **Lattice Intent Authority** owns USER provenance used to authorize canonical intent mutation, consistent with the System Registry and OD-004. Conversation ownership governs access to the message graph; it does not acquire intent semantics.

Current persisted intent-message provenance includes identity such as:

```text
conversationId
intentScopeId
logicalUserTurnId
messageId
messageHorizon
content
contentDigest
origin = USER
createdAt
```

**Mutability:** append-only / immutable after accepted persistence.

Reusing the same message, logical-turn, or message-horizon identity with different provenance must fail rather than overwrite the original record.

**Authority rule:** transcript text is context and provenance, not canonical intent. Only Intent Authority may commit USER-supported structured meaning into an `IntentVersion`.

### 6.3 IntentScope and IntentVersion

**Role:** canonical structured USER meaning.

**Owner:** **Lattice Intent Authority**.

`IntentScope` provides stable decision-intent identity and lineage control. `IntentVersion` records exact structured state plus immutable lineage.

**Mutability:**

- committed `IntentVersion` records are immutable;
- the IntentScope current-version pointer and sequencing metadata may advance under Intent Authority control;
- update, correction, revert, reset, and other accepted semantic changes create explicit successor lineage rather than rewriting history.

**Revision semantics:**

- `IntentVersion.version` orders accepted USER-meaning versions within one IntentScope;
- `intentVersionId` is the exact immutable identity used by downstream binding;
- message horizon identifies the observed USER-message boundary used by the transition.

A newer IntentVersion changes what is current. It does not mutate an already-bound DecisionPlan or historical Run.

**Scope closure rule:** IntentScope closure, where applicable, is non-destructive lifecycle state and is distinct from privacy deletion/purge. Closing a scope must not be treated as authorization to erase historical state, and deletion must not be implemented merely as semantic scope closure.

### 6.4 DecisionPlan

**Role:** durable exact planning contract between one accepted `IntentVersion` and one Run.

**Semantic authority:** **none independently.** DecisionPlan is an implementation-level durable binding, not a peer Product authority.

**Authority relationship:**

- Intent Authority owns the USER meaning and exact `IntentVersion`;
- DecisionPlan freezes a faithful planning projection of that exact version;
- Execution Runtime consumes that frozen projection for the bound Run.

Current durable identity includes:

```text
decisionPlanId
runId
intentScopeId
intentVersionId
planningMaterial
boundAt
```

**Mutability:** immutable once bound.

Binding the same Run identity to different planning material must fail. Replaying an identical bind may return the existing plan.

A DecisionPlan may never become an editable second copy of USER intent.

### 6.5 Run

**Role:** durable operational composition envelope.

**Owner:** **Lattice Execution Runtime** for lifecycle, coordination, cancellation, recovery, and operational state.

A Run may durably contain or reference:

- exact request/planning material;
- status and version;
- event/progress sequence;
- V36 snapshots/checkpoint references;
- Decision Engine output;
- Solandra renderings/explanations where currently persisted;
- cancellation/supersession state; and
- dispatch/recovery state.

Persisting another subsystem's output in a Run does not transfer ownership of that output to Runtime.

**Mutability:** controlled state machine with compare-and-swap versioning.

Current transitions use `expectedStatus` + `expectedVersion`; a stale transition fails rather than overwriting newer Run state.

**Revision semantics:** `Run.version` is the Runtime operational concurrency epoch. It is not an IntentVersion, V36 truth version, Decision Engine semantic revision, or presentation revision.

### 6.6 Operational results and continuation records

Workers/providers may produce durable result envelopes, dispatch records, research results, retry metadata, leases, and continuation transport records.

**Owner:** Execution Runtime for operational lifecycle and delivery.

**Authority rule:** worker/provider success is not USER intent, V36 truth, or Decision Engine authority. Operational results remain non-authoritative material until the owning semantic subsystem accepts them through its own contract.

For confirmed V36 durable continuation:

```text
V36
  -> NEEDS_RESEARCH { immutable checkpoint, researchRequests[] }

Execution Runtime
  -> durable schedule / execute / persist immutable results

V36.resume(exact checkpoint, exact results)
  -> NEEDS_RESEARCH again or authoritative truth state
```

Every V36 research yield uses a full immutable checkpoint sufficient for authoritative continuation, consistent with OD-002. Runtime owns execution and persistence of operational results; V36 owns epistemic need, admission, sufficiency, contradiction/corroboration, further-round need, and truth verdict.

Late or mismatched results may not be attached to a different V36 checkpoint merely because they completed successfully.

### 6.7 V36 evidence, checkpoints, and truth state

**Role:** authoritative external factual truth/evidence state.

**Owner:** **V36 Truth Core**.

Current Run integration persists `TruthSnapshot` state with identity including:

```text
runId
phase                 // currently INVESTIGATED | VALIDATED
executionContractId
bundleHash
bundle
```

The semantic bundle hash binds structured truth content independently of persistence row order.

**Mutability / checkpoint rule:**

- a committed V36 checkpoint or snapshot is immutable in meaning at that exact identity;
- later qualified V36 state may supersede it as the current checkpoint/state;
- supersession must not be modeled as silently rewriting an earlier immutable V36 checkpoint identity;
- V36 alone determines whether the later state is epistemically valid.

The current `TruthSnapshot` storage shape may expose only the current Run-integrated snapshot, while OD-002 separately requires full immutable continuation checkpoints at each research yield. Storage mechanics must preserve both contracts without conflating them.

**Epoch semantics:** current Run-integrated truth identity uses Run identity, phase, execution-contract identity, and semantic content hash. If later qualified V36 design introduces an explicit truth epoch/revision, it remains V36-owned and distinct from `Run.version`.

### 6.8 StructuredDecision

**Role:** authoritative Decision Engine output over exact intent/planning and admitted evidence.

**Owner:** **Lattice Decision Engine**.

The authoritative decision outcome may include, as qualified by current Decision Engine design:

- hard-requirement outcomes;
- eligibility;
- preference/utility evaluation;
- material-dominance frontier membership;
- tie/outcome semantics;
- reasons for materially distinct options; and
- delegated selection / winner only where the valid Product state and USER authorization permit one.

Lattice does **not** require every decision to collapse to a forced #1 winner.

**Mutability:** write-once for one exact decision execution/basis. A changed authoritative outcome requires a new valid decision execution/basis or successor Run, not in-place reinterpretation of an already-persisted decision.

**Basis rule:** StructuredDecision must remain attributable to the exact planning material and admitted V36 state from which it was produced.

Runtime may persist the result; persistence does not transfer decision authority to Runtime.

### 6.9 Solandra presentation projection

**Role:** faithful human-facing projection over authoritative Product state.

**Owner:** **Solandra Experience** for presentation/interaction semantics only.

Current implementation reconstructs a `SolandraPresentationSnapshot` from basis identifiers such as:

```text
conversationId
runId?
runVersion?
decisionPlanId?
intentVersionId?
```

It derives semantic phase, current understanding, uncertainty, supporting knowledge, action/recommendation presentation where present, resource descriptors, and `presentationRevision`.

**Mutability:** no independently mutable presentation-truth record.

**Revision semantics:** `presentationRevision` is a deterministic digest of the current projected snapshot. It is a stale-view/concurrency token, not a Product-semantic revision lineage.

A client may hold temporary view state such as the currently opened resource. That state must not alter the authoritative Product graph.

If a presentation snapshot is cached, the cache must be discardable and reproducible from its exact authoritative basis. Cached prose, labels, resources, or summaries may never outrank current Intent Authority, V36, Decision Engine, or Runtime state.

## 7. Immutable versus mutable records

| State | Default lifecycle / mutability |
| --- | --- |
| Conversation identity/owner | Immutable |
| Conversation deletion marker | Active -> deleted; no silent reactivation |
| USER Message / intent provenance | Immutable / append-only |
| IntentVersion | Immutable |
| IntentScope current pointer/sequencing | Mutable under Intent Authority |
| IntentScope closure state | Non-destructive lifecycle state; distinct from privacy deletion |
| DecisionPlan | Immutable once bound |
| Run status/version | Mutable through Runtime CAS lifecycle |
| Run event history | Append-only |
| V36 research checkpoint | Immutable at exact checkpoint identity |
| operational research result | Immutable result identity or epoch/checkpoint-bound |
| current V36 Run-integrated snapshot pointer/state | May advance only through V36-owned transition contract |
| StructuredDecision for exact decision basis | Write-once |
| Solandra presentation snapshot | Reconstructed / replaceable derived state |
| client interaction state | Ephemeral |

When semantically immutable state needs to change, Lattice should create an explicit new version, successor, superseding record, or later checkpoint rather than editing history.

## 8. Revision and epoch semantics

Lattice must not use one global version number for unrelated state domains.

### 8.1 Intent version

`IntentVersion.version` orders accepted USER-meaning versions within one IntentScope.

### 8.2 Message horizon

`messageHorizon` binds an intent interpretation/transition to the USER-message boundary it observed.

### 8.3 Run version

`Run.version` is the Execution Runtime compare-and-swap epoch protecting lifecycle mutation and stale workers.

### 8.4 V36 checkpoint identity

V36 continuation uses exact immutable checkpoints. Current Run-integrated truth snapshots additionally use phase, execution-contract identity, and semantic bundle hash.

These are V36/continuation identities, not aliases for Run version.

### 8.5 Decision basis identity

A StructuredDecision must remain bound to the exact planning and admitted-evidence basis from which it was produced. Do not infer decision freshness solely from a Run ID or presentation state.

### 8.6 Presentation revision

`presentationRevision` identifies the exact reconstructed presentation snapshot used by the client. It protects stale UI/resource actions but carries no independent intent, truth, or decision authority.

### 8.7 Rule against version conflation

A transition in one domain does not automatically advance another.

Examples:

- a new IntentVersion does not mutate an already-bound Run;
- a Run status transition does not create a new IntentVersion;
- a V36 validation or continuation checkpoint does not change USER preference state;
- a new StructuredDecision basis cannot be inferred from changed Solandra prose; and
- a presentation revision does not create new truth or decision state.

Cross-domain dependencies should bind exact IDs/checkpoints/versions rather than infer meaning from “latest.”

## 9. Idempotency architecture

Idempotency protects durable identity from duplicate transport/execution. It does not collapse legitimate semantic changes.

Current API control composes idempotency identity from:

```text
subject scope
HTTP method
canonical route
idempotency key
```

with a canonical request hash.

Required semantics:

1. same idempotency identity + same request hash -> replay existing result;
2. same identity + different request hash -> conflict;
3. different authenticated subject -> independent scope;
4. replay must not create a second Run, DecisionPlan, message, or semantic transition;
5. lower-level durable identities must independently reject conflicting reuse where required; and
6. expiry of transport-level idempotency metadata does not make an immutable Product identity reusable with different meaning.

Examples already present include USER-message identity checks and DecisionPlan same-Run binding checks.

Idempotency records are operational/provenance state, not canonical USER intent, V36 truth, or Decision Engine output.

## 10. Restart and reconnect reconstruction

A durable deployment must reconstruct Product state after process loss from persisted authoritative/durable records, excluding explicitly ephemeral client state.

Reconstruction begins from the authenticated ownership root:

```text
AuthenticatedSubject
 -> owned active Conversation
 -> ordered USER provenance/messages
 -> IntentScope + current/historical IntentVersions
 -> Conversation-associated Runs
 -> exact DecisionPlan per Run
 -> current Run lifecycle/version/events
 -> exact V36 continuation checkpoint/result state when research is in flight
 -> current persisted V36 truth checkpoint/evidence state
 -> StructuredDecision if committed
 -> reconstruct Solandra presentation
```

Reconnect must not:

- reconstruct canonical intent by asking a model to resummarize a transcript when committed IntentVersion state exists;
- reconstruct V36 truth from historical prose or provider output when V36 state exists;
- reconstruct authoritative decision state from explanation text or UI labels when StructuredDecision exists; or
- require a stored Solandra presentation-truth table when presentation can be recomposed from authoritative state.

If a derived cache is missing after restart, regenerate it. Missing canonical semantic state or required durable continuation state is a durability failure, not a cache miss.

## 11. Stale-state invalidation

Stale-state rejection belongs at the subsystem boundary that owns the relevant revision/checkpoint contract.

### 11.1 Intent stale state

Intent transitions based on obsolete base versions, message horizons, or proposal bindings must reject/reconcile under Intent Authority rules rather than overwrite newer USER meaning.

### 11.2 Run stale state

Lifecycle writes require exact expected Run status/version. Late workers or retries targeting an obsolete Run version must be rejected as stale.

### 11.3 V36 stale state

Research results and continuation calls must match the exact immutable V36 checkpoint/execution contract that requested them. Late material cannot strengthen a different or newer V36 state simply because work completed successfully.

### 11.4 Decision stale state

A StructuredDecision may be persisted only against the exact decision basis and permitted Run epoch. A late or conflicting decision result may not replace an already-committed authoritative outcome.

### 11.5 Presentation stale state

View-dependent resource hydration/actions should require expected `presentationRevision` wherever an old UI projection could expose inconsistent resources or actions.

### 11.6 General invalidation rule

> **Stale derived state is discarded; stale authoritative writes are rejected.**

A stale cache may be recomputed. A stale semantic write must not be silently rebased onto newer state.

## 12. Deletion, retention, and purge propagation

M8 establishes Conversation as the ownership root and separates immediate user-access deletion from later physical purge.

### 12.1 Immediate deletion

When an owned Conversation becomes `DELETED`:

- normal Conversation reads fail closed;
- normal message/transcript reads become inaccessible;
- intent reads/mutations for that Conversation graph become inaccessible;
- new DecisionPlan/Run creation is blocked;
- existing Run read/cancel/continue operations become inaccessible through normal user APIs;
- progress/SSE reconnect is blocked;
- result/decision reads are blocked;
- Solandra presentation/resource hydration is blocked; and
- continuity reconstruction must not expose retained child state.

Immediate deletion is an access/lifecycle barrier across the graph even if some state remains physically retained pending separately governed policy.

Deletion status does not rewrite historical provenance while retained historical state still exists.

### 12.2 Retained deleted state

Retained state may exist only for a separately justified retention, purge, legal-hold, audit, or recovery purpose.

Retained access paths must be internal, narrow, non-user-facing, and semantically distinct from active Product reads.

Current Conversation storage exposes explicit retained lookup and purge-candidate operations; those surfaces must not become alternate normal-user access paths.

### 12.3 Purge propagation

When separately qualified policy makes an owned deleted Conversation purge-eligible, purge must remove or irreversibly sever **user-data-bearing Product state that is exclusively owned by that graph**.

The purge plan must account for at least:

```text
Conversation
USER Messages / transcript provenance
IntentScope / IntentVersions / pending proposals
DecisionPlans
Conversation <-> Run index/bindings
Runs / events / explanations / operational results
V36 continuation checkpoints/results scoped only to those Runs
V36 evidence/truth state scoped only to those Runs
StructuredDecision state scoped only to those Runs
idempotency/control records retaining user/request content or identifiers
presentation caches/resources, if any
```

Deletion order is an implementation concern and may be foreign-key/cascade driven. The semantic requirement is that a completed purge must not leave user-data-bearing convenience copies capable of restoring the purged Product graph.

Shared records must not be deleted merely because one Conversation referenced them unless ownership semantics prove they are exclusive to the purged graph.

### 12.4 Separately governed audit/legal retention exception

OD-007 permits a retained audit/provenance record only when it is separately justified, minimal, and semantically distinguishable from active user-accessible Product state.

Accordingly, “graph-complete purge” in this document means graph-complete removal/severance of purge-eligible **Product user data**, not an invented requirement to destroy separately governed legal-hold, audit, security, or backup records outside the qualified purge scope.

Any permitted residual record must:

- have separate qualified authority for retention;
- contain no more user data than necessary for that purpose;
- remain inaccessible through normal Product continuity/read paths;
- not become reusable USER intent, V36 truth, Decision Engine state, or Solandra memory; and
- not be sufficient to silently reconstruct the purged active Product graph.

### 12.5 Policy remains separate

This architecture does not invent retention durations, legal-hold rules, audit-log durations, backup destruction timing, or provider-specific deletion policy. Those require separately qualified Product/operational authority.

## 13. State that must never become a second source of truth

The following may be persisted only as derived, provenance, or operational material under an exact basis. They must not become independently editable semantic authorities.

### 13.1 Transcript-derived intent summaries

Do not persist a free-form “what the user wants” summary and later use it instead of canonical IntentVersion state.

### 13.2 DecisionPlan as editable intent

Do not mutate DecisionPlan planning material to follow later USER meaning. A new Run must bind a new exact plan when the authoritative intent basis changes.

### 13.3 Run-owned truth

Do not let a Run row, operational result, retrieval result, or provider result become factual truth independently of V36 admission.

### 13.4 Explanation-owned decision

Do not infer eligibility, frontier membership, delegated selection, tie/outcome, or winner from explanation prose or UI labels when authoritative StructuredDecision state exists.

### 13.5 Historical truth as generalized memory

Do not promote prior V36 facts into a later decision merely because they are durable or appeared in a previous Conversation.

### 13.6 Solandra presentation state

Do not introduce an independently mutable presentation table containing copied understanding, uncertainty, truth, frontier/winner state, “next step,” or explanation semantics when those values can be reconstructed from authoritative Product state.

### 13.7 Continuity response

Do not treat a reconnect/continuity response payload as the source from which canonical state is later restored.

### 13.8 Search/index/cache state

Do not let indexes, denormalized lookup rows, embeddings, materialized views, or caches become writable semantic authorities.

### 13.9 Model/provider context

Do not persist model/provider context projection and later treat it as canonical Product state merely because it serializes intent/truth/decision material.

### 13.10 Account-level generalized memory

Do not create generalized conversational memory from transcript, Solandra inference, historical recommendation, model inference, or prior external facts. Lattice 1.0 cross-conversation continuity is limited to explicit USER-authored or exact USER-confirmed preference state under Intent Authority, copied by value with provenance into exact IntentScope/IntentVersion state when used.

## 14. Persistence boundary rules

Every durable adapter must preserve the same semantic Product contracts as its in-memory counterpart unless a separately qualified design explicitly changes the contract.

PostgreSQL is a durability mechanism, not a different Product model.

For every persisted concept, implementation should make these questions answerable:

1. Who owns the meaning?
2. What is the immutable identity?
3. What fields may change?
4. What version/checkpoint/epoch guards mutation?
5. What makes replay identical versus conflicting?
6. What ownership root governs access?
7. What is required to reconstruct after restart?
8. What makes a derived copy stale?
9. What happens on deletion?
10. What is the purge/retention dependency?

If these answers cannot be stated, the persistence shape is underspecified.

## 15. Transaction and ordering expectations

Not every cross-system operation requires one database transaction, but no partial durable state may create ambiguous authority.

Required ordering principles include:

- USER provenance must exist before an IntentVersion claims that source;
- an exact IntentVersion must exist before a DecisionPlan binds it;
- DecisionPlan binding must be established before or atomically with Run intake that depends on it;
- Run lifecycle transitions must use exact expected Runtime version;
- a V36 research continuation must use the exact immutable checkpoint that yielded the work;
- a Run-integrated V36 snapshot must satisfy the V36-owned checkpoint/transition contract before persistence commits it;
- StructuredDecision persistence must use the exact permitted decision basis/Run epoch; and
- Solandra presentation must be composed only after its authoritative basis is ownership-validated and readable.

Where persistence spans multiple stores/tables, transaction boundaries, outbox, deterministic retry, or compensating recovery must preserve these invariants across restart.

## 16. Failure semantics

### 16.1 Canonical semantic write failure

Do not claim the semantic transition occurred. Retry only through an identity/replay contract that cannot create divergent meaning.

### 16.2 Operational transition failure

The last committed Run epoch remains authoritative for Runtime lifecycle. Workers may retry against the permitted epoch; they may not assume an uncommitted transition succeeded.

### 16.3 V36 continuation persistence failure

Do not synthesize or skip the lost checkpoint. Resume only from a durably recoverable exact immutable V36 checkpoint/result set or fail with the continuation state explicitly unresolved.

### 16.4 Derived-state generation failure

Do not corrupt canonical state. Presentation/cache output may be regenerated from the same exact basis.

### 16.5 Partial purge failure

Keep the Conversation inaccessible. Retain only the bounded operational information required to safely resume purge, under the applicable retention authority. Do not mark purge complete until the qualified purge scope is satisfied.

## 17. Current implementation alignment

At the reconciliation baseline, current source demonstrates several mechanisms required by this architecture:

- Conversation ownership plus `deletedAt` and separate active/retained reads;
- USER-message append-only identity with content digest and message horizon;
- immutable versioned IntentVersion lineage;
- immutable exact DecisionPlan binding with conflicting same-identity rejection;
- Run compare-and-swap lifecycle through expected status/version;
- V36 Run-integrated truth snapshot integrity through phase, execution contract, and semantic bundle hash;
- subject-scoped API idempotency using canonical request hashes;
- StructuredDecision persistence guarded by exact Run epoch;
- Solandra presentation reconstruction with deterministic `presentationRevision`; and
- stale resource protection using the expected presentation revision.

This document does **not** claim that graph-complete physical purge, every cross-store transactional boundary, every durable research-result lifecycle, every V36 continuation persistence detail, or every cache invalidation mechanism is fully implemented.

It also does not reinterpret current single-winner presentation code as the universal Decision Engine Product contract; the confirmed generalized decision design retains material-dominance frontier/tie/delegation semantics.

## 18. Validation design

A future exact-candidate implementation/acceptance campaign should prove, as applicable to the implemented scope:

1. committed USER provenance cannot be rewritten through identity reuse;
2. stale intent transitions cannot overwrite a newer IntentVersion;
3. a DecisionPlan cannot change meaning after binding;
4. duplicate Run submission with identical idempotency identity/request replays rather than duplicates;
5. conflicting duplicate submission fails;
6. stale Run workers cannot advance an obsolete version;
7. V36 continuation resumes from the exact immutable checkpoint that yielded the research request;
8. late research/provider results cannot attach to the wrong V36 checkpoint;
9. V36 truth-snapshot integrity detects changed structured truth content;
10. StructuredDecision cannot persist against the wrong basis/Run epoch;
11. decision persistence does not force a winner when the qualified outcome is a frontier/tie/non-selection;
12. process/PostgreSQL restart reconstructs the same conversation/intent/plan/Run/V36/decision graph;
13. Solandra presentation reconstructs from authoritative state without an independent presentation-truth store;
14. stale `presentationRevision` resource access is rejected;
15. deletion immediately blocks every normal user-facing child surface;
16. retained-deleted state is inaccessible through normal APIs;
17. authorized purge removes/severs the complete purge-eligible exclusive user-data graph; and
18. no cache/index/presentation/audit residual can silently restore purged or superseded semantic state as current authority.

Passing documentation review does not satisfy these behaviors; they require executed evidence on exact implementation state.

## 19. Migration and implementation guidance

The smallest migration path is incremental rather than a persistence rewrite.

1. Preserve existing subsystem stores and semantic ownership.
2. Use this document as the cross-system contract for new persistence work.
3. Add exact basis/version/checkpoint fields before adding caches or denormalized projections.
4. Extend deletion propagation checks before physical purge execution.
5. Add purge only when retention policy and affected storage surfaces are sufficiently qualified.
6. Preserve Solandra presentation reconstruction; add discardable caches only for demonstrated need.
7. Add explicit V36 or operational epochs only when current checkpoint/identity contracts are insufficient for a demonstrated requirement.
8. Prefer foreign keys, unique constraints, CAS conditions, immutable records, and transaction boundaries that mechanically encode the qualified invariants.

Do not introduce a generic event-sourcing framework, universal revision service, global state manager, or duplicate cross-system persistence layer merely to centralize these concerns. The architecture requires consistent ownership contracts, not one physical store.

## 20. Architectural invariants

The state architecture remains correct only while all of these remain true:

1. **One semantic owner per concept.**
2. **Persistence never transfers authority.**
3. **Historical semantic records and exact checkpoints are not silently rewritten.**
4. **Mutable Runtime state is epoch-guarded.**
5. **Exact IDs/versions/checkpoints cross subsystem boundaries.**
6. **Idempotent replay cannot create divergent meaning.**
7. **Restart reconstruction uses canonical durable state, not lossy regenerated prose.**
8. **Stale derived state is discarded; stale authoritative writes are rejected.**
9. **Deletion blocks the whole owned Product graph immediately.**
10. **Purge removes/severs the qualified purge-eligible user-data graph without inventing policy for separately governed audit/legal records.**
11. **IntentScope closure remains distinct from privacy deletion.**
12. **V36 continuation checkpoints remain immutable and V36 epistemic authority remains exclusive.**
13. **StructuredDecision may represent frontier/tie/delegation/winner semantics as qualified; persistence does not force a winner.**
14. **Derived Solandra presentation remains reconstructible and subordinate to its basis.**
15. **No cache, index, summary, transcript, model context, explanation, continuity response, or stored projection may silently become a second semantic authority.**

## 21. Structural summary

```text
                 OWNERSHIP / ACCESS ROOT
                         Conversation
                              |
              +---------------+---------------+
              |                               |
              v                               v
     immutable USER provenance         deletion lifecycle
              |
              | exact source binding
              v
       Lattice Intent Authority
         IntentVersion[n]
              |
              | faithful immutable binding
              v
          DecisionPlan
              |
              v
             Run <------ Runtime CAS epoch / events / recovery
              |
       +------+------+------------------+
       |             |                  |
       v             v                  v
 V36 immutable   worker/provider    V36 truth state
 continuation       material         / evidence
 checkpoints          |                  |
       ^              |                  |
       +--------------+------------------+
                      |
                      v
              Lattice Decision Engine
                StructuredDecision
        frontier / tie / selection as valid
                      |
                      v
              Solandra Experience
            reconstructed presentation
              presentationRevision
                      |
                      v
          ephemeral client interaction state
```

The durable graph should therefore be read as:

> **USER-authored provenance becomes canonical intent only through Intent Authority; exact intent becomes executable through an immutable DecisionPlan; Runtime advances work through guarded operational epochs; V36 alone governs epistemic continuation and factual admission; the Decision Engine alone produces authoritative decision state; and Solandra reconstructs a faithful presentation from those states without becoming another truth or decision store.**

## 22. Draft status and next use

This document is a **RECONCILED DRAFT** against canonical `main @ 648bcc7241d6827736fbce6e2c52524465f086da` and the Owner-directed persistence requirements for this Work Item.

It has been reconciled against the current Foundational Design Principle, Architecture Integrity, System Registry, System Architecture, confirmed living-design amendments for OD-002/OD-003/OD-004/OD-007, M8 continuity architecture, and the current Solandra reconstructed-presentation boundary.

It is intended to become the cross-system state/persistence ownership reference for later implementation and review. It does not by itself claim that all described lifecycle mechanisms are implemented, accepted, production-ready, or governed by a qualified retention duration.
