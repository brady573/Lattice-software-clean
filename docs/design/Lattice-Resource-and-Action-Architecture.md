# Lattice Resource and Action Architecture

Status: **OWNER-DIRECTED CROSS-SYSTEM RESOURCE/ACTION ARCHITECTURE — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Repository design baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This document is subordinate to the Core and current Owner decision OD-011.

## 1. Purpose

Resources make Solandra's help usable. Action trust makes consequential execution safe.

The central rule remains:

> **A Resource can help a person act. A Recommendation can advise. Neither silently authorizes execution.**

## 2. Stable action chain

```text
Knowledge / Recommendation
      |
      v
Resource or ActionProposal
      |
      v
Authorization (when required)
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

The distinctions are normative:

- `Recommendation != ActionProposal`
- `ActionProposal != Authorization`
- `Authorization != Execution`
- `ExecutionReceipt != Verification`

## 3. Resource

A Resource is an application object that materially helps the person understand, decide, inspect support, prepare, or act.

Kinds may include:

```text
TEXT
LINK
CONTACT
IMAGE
VIDEO
AUDIO
DOCUMENT
MAP_OR_LOCATION
PREPARED_MESSAGE
CHECKLIST
FORM
COMPARISON
GENERATED_ARTIFACT
OTHER_QUALIFIED_RESOURCE
```

Resource kind is not an authority class.

## 4. Resource provenance and basis

A material Resource should remain attributable to the exact governed basis that made it useful, including as applicable:

- Intent;
- Knowledge/Claim/Evidence/Source refs;
- Recommendation;
- optional formal decision result;
- capability result;
- generation/retrieval operation;
- Conversation/subject ownership.

A generated or retrieved Resource does not gain factual truth merely because it is polished or useful.

## 5. Resource identity and versioning

Keep distinct:

```text
resourceId
resourceVersion
ConversationReference
ActionProposal version/digest
operationId
presentationRevision
```

Execution-significant edits produce a new Resource or ActionProposal version. Presentation-only changes do not create new action meaning.

## 6. Resource validity remains multi-axis

Preserve the existing three independent questions:

1. **Basis relevance** — does this Resource still belong to the current need/basis?
2. **Content/source validity** — are material external claims/destinations still valid under Knowledge/provenance rules?
3. **Availability** — can Lattice currently hydrate/supply it?

Do not collapse these into one generic stale flag or TTL.

## 7. Resource production

Resources may come from:

- deterministic projection of governed state;
- retrieval through a bounded capability;
- generation through a bounded capability;
- USER editing of a prepared draft.

Factual retrieval/generation routes through Knowledge Trust where correctness matters. Capability success is not Knowledge admission.

## 8. Resource use is not action authority

Application-issued Resource uses may include:

```text
VIEW
COPY
DOWNLOAD
PLAY
OPEN_EXTERNAL
SHOW_LOCATION
EDIT_LOCAL_DRAFT
USE_AS_INPUT
PRINT_OR_EXPORT
PREPARE_ACTION
```

A Resource payload cannot self-issue capabilities. UI labels do not determine side-effect or consequence classification.

Opening an external destination does not prove the intended external action succeeded.

## 9. Preparation versus execution

Preparation can include:

- drafting a message;
- filling a local form;
- preparing a calendar event;
- assembling order details;
- generating a document/checklist;
- selecting a contact/location;
- preparing structured capability inputs.

Preparation does not itself perform target actions such as:

```text
SEND
SUBMIT
SCHEDULE
PURCHASE
TRANSFER
DELETE
PUBLISH
CHANGE_PERMISSION
OTHER_CONSEQUENTIAL_MUTATION
```

Preparation may still use external processing and remains subject to privacy, egress, budget, and capability policy.

## 10. Recommendation

A Recommendation is advisory Solandra Product state grounded in governed Intent and Knowledge.

A Recommendation may lead to Resource creation or an ActionProposal, but it never supplies external-action Authorization by itself.

A USER saying “I like that option” may update conversational/intent state; it does not automatically authorize consequential execution.

## 11. ActionProposal

An `ActionProposal` is exact prepared action meaning.

Conceptually it binds:

```text
actionProposalId
actionProposalVersion
proposalDigest
target/action kind
exact arguments
resource refs
intent/knowledge/recommendation basis
capability ID/version
effect class
consequence class
reversibility
idempotency
authorization requirement
verification method
```

Once shown for authorization or dispatch, execution-significant fields are immutable. Any material change creates a successor version/digest.

## 12. Natural “Do it” behavior

ConversationReference lets Solandra resolve “Do it” to the exact prior Recommendation/Resource/ActionProposal.

The safe behavior is:

1. resolve the referent;
2. determine whether an exact current ActionProposal already exists;
3. if not, prepare one from the referenced governed basis;
4. check whether existing Authorization covers that exact proposal;
5. if not, ask naturally for the narrow authorization required;
6. execute only after the final Runtime policy/binding check.

A pronoun/reference is not itself Authorization.

## 13. Authorization

Authorization is a separate durable trust object for actions whose consequence class requires it.

At minimum it must preserve:

- authorized subject;
- exact ActionProposal version/digest;
- scope;
- freshness/expiry or single-use semantics where applicable;
- any required contextual constraints.

Authorization invalidates/fails closed when execution-significant proposal meaning changes or ownership/basis becomes invalid.

## 14. ExecutionReceipt

Execution produces a durable receipt/equivalent operational record containing enough exact information to prevent blind duplication and support recovery/verification.

It may record external IDs/status, timestamps, executor/capability identity, normalized response, and ambiguity state.

ExecutionReceipt means **the executor/runtime reports this happened**. It is not automatically proof that the intended resulting state is real and current.

## 15. Verification

Verification answers:

> **Can Lattice establish that the intended resulting state actually occurred?**

Prefer independent observation/status read when a qualified capability exists.

Examples:

- after sending: query authoritative message/sent state when available;
- after booking: read authoritative reservation state;
- after file edit: re-read the target state;
- after permission change: query current permission state.

If only the initiating executor's success response exists, Solandra may report that the operation was reported successful but not overstate independent verification.

## 16. Ambiguous completion

For non-idempotent/consequential actions, timeout/network loss/process failure after possible dispatch creates first-class ambiguity.

Do not:

- infer non-execution from timeout;
- infer success from telemetry/model narrative;
- invite blind duplicate execution.

Recover by authoritative external status/idempotency evidence when possible, otherwise preserve an explicit ambiguous/action-required state.

## 17. Subject ownership, deletion, and hydration

Resource/action access remains rooted in the authenticated owned Product graph.

Resource IDs, ActionProposal IDs, receipts, and references are not bearer capabilities. Cross-subject guessing fails closed without useful existence leakage.

Deletion immediately blocks normal access to Resources, saved drafts, ActionProposals, Authorization, ExecutionReceipt, Verification, and derived caches in the owned graph.

## 18. ConversationReference and source inspection

A turn may reference Resource, Recommendation, ActionProposal, ExecutionReceipt, and Verification objects.

This lets follow-ups remain grounded:

- “Open that document.” -> exact Resource.
- “Send it.” -> exact current prepared message/ActionProposal, then Authorization check.
- “Did it actually work?” -> exact ExecutionReceipt -> Verification state.

References do not duplicate authority.

## 19. Persistence guidance

Persist exact Resource/action state when continuity, non-determinism, USER edits, authorization, recovery, or verification requires it.

Deterministic display-only projections can remain reconstructible if their governed basis is retained.

Do not use presentation revision as permanent Resource/action identity.

## 20. Solandra Composer

Composer determines **when/how** a Resource or action state is useful to present. This architecture determines **what that object means**.

A substantial Resource may take over Composer while Conversation and ConversationInput remain available. Presentation does not authorize execution.

## 21. Current implementation alignment

Current source already demonstrates useful Resource/provenance/hydration, subject ownership, stale-view, Action Preparation, and execution-safety foundations.

First-class durable Recommendation, ActionProposal, Authorization, ExecutionReceipt, Verification, and ConversationReference behavior remains target architecture and requires later implementation evidence.

## 22. Anti-collapse invariants

1. `Resource != UI component`.
2. `Resource shown != Recommendation accepted`.
3. `Recommendation != Authorization`.
4. `Prepared message != sent message`.
5. `Prepared form != submitted form`.
6. `Retrieved source != governed Knowledge`.
7. `Generated artifact != verified fact`.
8. `ActionProposal != Authorization`.
9. `Authorization of proposal N != authorization of N+1`.
10. `Capability license != consequential Authorization`.
11. `ExecutionReceipt != Verification`.
12. `Open external != target action succeeded`.
13. `Idempotent != consequence-free`.
14. `Reversible != non-consequential`.
15. `ConversationReference != action authority`.

## 23. Validation direction

Later exact-revision probes should prove source/basis validity, subject isolation, exact proposal versioning, narrow authorization, restart-safe operation identity, ambiguous-completion protection, and independent Verification where available.
