# Lattice State, Persistence, and Lifecycle Architecture

Status: **OWNER-DIRECTED CROSS-SYSTEM STATE ARCHITECTURE — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Repository design baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This document is subordinate to the Core and current Owner decision OD-011.

## 1. Purpose

Persistence preserves governed Product state and safe operational continuation. It never transfers authority merely because data is durable.

The target durable graph expands the predecessor Run/Intent/V36/decision composition into explicit Knowledge, Recommendation, conversational-reference, action-authorization, and verification state.

## 2. Governing rule

> **Durability preserves the exact meaning established by the owning trust boundary; derived prose, UI, telemetry, and operational transport must not become substitute authority.**

## 3. Target durable Product graph

```text
Authenticated Subject
       |
       v
Conversation
       |
       +--> USER Message / provenance
       |
       +--> Intent lineage
       |
       +--> ConversationReference
       |       +--> Intent
       |       +--> Knowledge
       |       +--> Recommendation
       |       +--> ActionProposal
       |       +--> Authorization
       |       +--> ExecutionReceipt
       |       +--> Verification
       |
       +--> Source -> Evidence -> Claim -> Knowledge
       |
       +--> Recommendation
       |
       +--> Resource / ActionProposal
                   |
                   v
              Authorization
                   |
                   v
              ExecutionReceipt
                   |
                   v
               Verification
```

Operational Runs/tasks/checkpoints may support these objects without replacing them.

## 4. State classes

### 4.1 Governed semantic/trust state

State whose meaning is established by an owning Product boundary:

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
- exact ConversationReference bindings.

### 4.2 Durable operational state

State required for safe execution/recovery:

- Run lifecycle/version;
- task/operation identity;
- dispatch/outbox state;
- attempts/leases;
- cancellation/supersession;
- V36 continuation checkpoints/results;
- capability result/provenance;
- retry/ambiguity state.

Operational state does not become semantic authority.

### 4.3 Provenance/ownership state

- authenticated subject ownership;
- Conversation ownership/deletion;
- USER message IDs/digests/horizons;
- lineage/predecessor IDs;
- exact basis refs/digests;
- capability/route provenance;
- idempotency request hashes.

### 4.4 Derived/reconstructible state

- Composer/read-model snapshots;
- presentation revision;
- cached explanation prose;
- progress summaries;
- indexes/materialized views;
- temporary resource-open state;
- model context projections.

Derived state may be cached but cannot outrank its governed basis.

## 5. Conversation and USER provenance

Conversation is the durable subject-owned interaction root. It does not itself own Intent, Knowledge, Recommendation, Authorization, or Verification meaning.

USER-authored messages/provenance are immutable/append-only once accepted under their identity. Identity reuse with different content fails rather than rewriting history.

## 6. Intent

Canonical Intent remains versioned/lineaged. Existing `IntentVersion` mechanisms are valid implementation foundations.

Rules:

- accepted historical versions are immutable;
- corrections create successor state;
- omission is not silent deletion of prior meaning;
- later conversation does not mutate an already-bound historical basis;
- Intent Integrity, not storage, controls semantic transition.

## 7. Source, Evidence, Claim, and Knowledge

### Source

Identifies material origin and provenance needed to interpret acquired information.

### Evidence

Represents material extracted/observed from a Source with the provenance, time, scope, and suitability needed for evaluation.

### Claim

Represents a proposition whose support/refutation/conflict state can be evaluated.

### Knowledge

Represents the governed result Lattice permits Solandra to rely upon for a defined basis.

Knowledge should retain, where material:

- claim refs;
- supporting/refuting/conflicting Evidence refs;
- Source refs;
- currency/temporal applicability;
- uncertainty/unresolved limits;
- exact trust/checkpoint/basis identity.

Existing V36 snapshots/checkpoints may underlie these objects. A storage redesign is not required merely to adopt the Product concepts.

## 8. Recommendation

Recommendation is durable advisory state produced by Solandra over exact governed inputs.

A historical Recommendation is immutable at its exact basis. If Intent or Knowledge changes materially, produce a successor Recommendation; do not rewrite the prior recommendation as though it had used the new evidence.

Recommendation must remain distinguishable from a formal Decision Engine result when the optional formal capability was used.

## 9. ConversationReference

ConversationReference is a durable referential binding between a conversational turn and governed objects.

Its purpose is continuity, not duplicated authority.

Conceptually it records exact refs such as:

```text
turnId
intentRefs[]
knowledgeRefs[]
recommendationRefs[]
resourceRefs[]
actionProposalRefs[]
authorizationRefs[]
executionReceiptRefs[]
verificationRefs[]
```

The exact schema may evolve.

Rules:

- reference target IDs are immutable historical facts of that turn;
- a reference does not copy/rewrite the target's meaning;
- a new answer based on new Knowledge gets new references rather than retroactively changing the old answer's provenance;
- deletion/subject access applies transitively.

## 10. ActionProposal

An ActionProposal is exact prepared execution meaning.

Execution-significant content is versioned/immutable once presented for authorization or dispatch. Material edits produce a successor proposal/version/digest.

ActionProposal is not Authorization.

## 11. Authorization

Authorization records narrow permission under the applicable action policy.

For consequential action it must bind enough exact state to establish what was authorized, by whom, under what scope/freshness, and against which ActionProposal.

Authorization must survive long enough for safe dispatch/recovery/audit but does not prove execution.

## 12. ExecutionReceipt

ExecutionReceipt records the executor/runtime's durable account of what operationally happened for one exact operation.

It may contain:

- operation/action proposal IDs;
- capability/executor identity;
- attempt/reuse identity;
- returned external identifiers;
- normalized outcome;
- timestamps;
- operational provenance;
- ambiguity state.

An ExecutionReceipt is evidence about execution, not verified external reality by itself.

## 13. Verification

Verification is the durable trust object that records what Lattice can establish about the intended resulting state.

Where possible, Verification should use independent observation or an authoritative status source distinct from the initiating execution report.

Possible outcomes may include the equivalent of:

```text
VERIFIED
NOT_VERIFIED
CONTRADICTED
AMBIGUOUS
UNVERIFIABLE_WITH_CURRENT_CAPABILITY
```

Exact enums are future design/implementation work. The required distinction is `ExecutionReceipt != Verification`.

## 14. Operational Run state

Run remains an implementation-level durable composition envelope for current code and later safe execution.

`Run.version` remains an operational concurrency epoch. It is not Intent version, Knowledge version, Recommendation version, Authorization version, or Verification state.

A later architecture may reduce how visible Run is upward without deleting the reliability value of exact operational identity.

## 15. Immutable versus mutable

Default rules:

- historical USER provenance: immutable;
- Intent versions: immutable, successor lineage;
- Source/Evidence/Claim/Knowledge exact records: immutable at exact identity/basis, successor/supersession where needed;
- Recommendation exact basis: immutable;
- ConversationReference: append-only/immutable historical binding;
- ActionProposal exact version: immutable;
- Authorization exact grant: immutable, may expire/revoke/supersede through explicit state;
- ExecutionReceipt: immutable operational record;
- Verification exact observation/result: immutable; later verification may supersede current status without rewriting old observation;
- Run/task lifecycle: mutable only through guarded operational state machine;
- presentation/cache: derived/reconstructible.

## 16. Idempotency and replay

Idempotency protects identity; it does not collapse legitimate semantic changes.

- exact duplicate USER message/request replays existing accepted state;
- same identity + materially different payload conflicts;
- duplicate operation delivery reuses accepted result where safe;
- ambiguous non-idempotent completion blocks blind redispatch;
- expired transport idempotency metadata does not make immutable Product identity reusable with different meaning.

## 17. Restart and reconnect

After restart, reconstruct from durable governed state:

```text
owned Conversation
 -> messages/provenance
 -> current/historical Intent
 -> relevant Knowledge graph
 -> Recommendation history/current refs
 -> Resources/action objects
 -> Authorization / ExecutionReceipt / Verification
 -> exact operational continuation state still in flight
 -> reconstruct ConversationReference-aware Solandra presentation/context
```

Do not:

- resummarize transcript to recreate canonical Intent when Intent exists;
- re-search to fabricate prior Knowledge provenance;
- reconstruct Recommendation from explanation prose when Recommendation exists;
- infer Authorization from chat wording alone when authorization state exists;
- infer verified success from a stored execution success message.

## 18. Staleness

Stale derived state is discarded. Stale authoritative writes are rejected.

- late cognition/capability output cannot attach to a superseded Intent/Knowledge/action basis;
- later Knowledge does not silently rewrite prior Recommendation provenance;
- authorization of ActionProposal N does not authorize N+1;
- an old ExecutionReceipt cannot prove the current external state after later contradictory Verification.

## 19. Deletion, retention, and purge

Deletion of an owned Conversation must immediately block normal access to the entire owned graph, including:

- transcript/provenance;
- Intent;
- Knowledge/Source/Evidence/Claim state owned exclusively by the graph;
- Recommendation;
- Resources;
- ConversationReference;
- ActionProposal/Authorization/ExecutionReceipt/Verification;
- relevant operational/caches/indexes.

Physical purge remains subject to separately qualified retention/legal/audit policy. Shared external/source records must not be deleted merely because one Conversation referenced them unless ownership semantics prove exclusivity.

## 20. No second source of truth

Never promote these into independent authority:

- transcript summaries;
- model context;
- generated explanation;
- UI labels;
- presentation snapshots;
- telemetry;
- cached source snippets;
- operational results not admitted by the owning trust boundary;
- ConversationReference copies instead of referenced objects.

## 21. Current implementation alignment

The baseline already demonstrates valuable mechanisms: Conversation ownership/deletion, USER-message identity, IntentVersion lineage, durable Run CAS, V36 checkpoint/snapshot integrity, idempotency, subject isolation, and reconstructed Solandra presentation.

The target first-class Knowledge, Recommendation, ConversationReference, Authorization, ExecutionReceipt, and Verification graph is **not** claimed to be fully implemented by this document.

## 22. Validation direction

Later exact-revision probes should prove:

- restart reconstructs the same governed object graph;
- old answer source requests traverse historical refs rather than re-searching;
- correction/new Knowledge creates successor state without rewriting history;
- cross-subject reference guessing fails closed;
- authorization binds exact proposal;
- ambiguous action survives restart without duplicate dispatch;
- ExecutionReceipt cannot be presented as Verification absent verification evidence;
- deletion blocks all normal child access;
- caches/telemetry cannot restore deleted or superseded authority.
