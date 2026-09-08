# Lattice Reliability, Recovery, and Observability Architecture

Status: **OWNER-DIRECTED CROSS-SYSTEM RELIABILITY ARCHITECTURE — RECONCILED BY OD-011**

Reconciled: **2026-09-08**

Repository design baseline: `main @ e35f57e0621b81a66285c729b124d0c87ce8dffa`, tree `e7eb933e228735e3cefe472bc0d4269c71b556fa`.

`The-Core-Lattice-Philosophy.md` remains unchanged and highest authority. This document is subordinate to the Core and current Owner decision OD-011.

## 1. Purpose

Reliability preserves exact Product work across unreliable processes/providers/tools without changing Product meaning or manufacturing authority.

The central rule remains:

> **Recover at the lowest boundary that can preserve exact Product meaning. Surface failure only when safe continuation, trustworthy state, or verified outcome can no longer be preserved.**

## 2. Reliability does not create trust authority

Recovery may replace attempts, workers, connections, or qualified execution routes. It may not replace:

- USER meaning;
- Knowledge/evidence standards;
- Recommendation basis;
- action Authorization;
- operation identity; or
- Verification.

`recovery success != authority transfer`.

## 3. Durable identity

Keep distinct:

```text
logical work/action identity
attempt identity
worker/process identity
provider request identity
Run version/epoch
ActionProposal identity/version
ExecutionReceipt identity
Verification identity
```

At-least-once delivery is acceptable only when durable acceptance remains logically once for the exact identity/basis.

## 4. Failure classes

Preserve the current useful categories:

- deterministic input/contract failure;
- stale/binding failure;
- transient infrastructure/provider failure;
- timeout/uncertain completion;
- duplicate delivery;
- dependency/capability unavailability;
- semantic insufficiency (Intent/Knowledge/Recommendation);
- persistence/integrity failure;
- authorization/privacy failure.

Retry behavior is determined by the class and exact operation contract, not by generic “try again” policy.

## 5. Retry

- deterministic/stale/policy failures do not retry unchanged;
- transient failures may retry boundedly when semantics remain equivalent;
- retry does not reset budgets;
- fallback cannot weaken role, privacy, provenance, truth, authorization, or verification requirements;
- changing material semantic input creates new work rather than disguising it as retry.

## 6. Cancellation

Cancellation is durable state. Best-effort abort is not proof that external work did not happen.

Late results after cancellation/deletion/supersession cannot become current state merely because execution succeeded.

## 7. Ambiguous completion

Ambiguous completion is a first-class reliability state.

```text
dispatch may have occurred
 -> response/outcome lost
 -> completion unknown
```

For non-idempotent or consequential actions:

- no blind redispatch;
- reconcile against authoritative external status or exact external idempotency semantics where available;
- otherwise preserve explicit ambiguity/action-required state;
- do not resolve ambiguity from model inference, telemetry, timeout, or missing callback.

## 8. ExecutionReceipt and Verification under recovery

Recovery must keep execution reporting separate from reality verification.

```text
ExecutionReceipt
  != Verification
```

A recovered/successful executor response may justify an ExecutionReceipt. It does not justify “verified complete” unless a qualified verification observation establishes the intended resulting state.

After ambiguous completion, Verification is the preferred recovery path when an independent read/status capability exists.

## 9. Solandra behavior during recovery

Solandra may reason about a safe next step and explain recovery naturally, but it must consume durable reliability/trust state rather than inventing an outcome.

The Product should hide provider/worker/Run machinery when recovery is healthy and user consequences are unchanged.

When user-visible, explain the consequence and safe next action rather than raw infrastructure detail.

## 10. Knowledge/research failure

Research execution failure does not imply a Claim is false.

Provider/source/tool failure may leave Knowledge incomplete/uncertain. Lattice Knowledge Trust/V36 decides whether evidence is sufficient, conflicting, stale, or unresolved.

Repeated operational failure cannot become negative evidence by itself.

## 11. Recommendation insufficiency

If Knowledge or Intent is insufficient for responsible advice, Solandra preserves that limitation. Reliability logic must not manufacture a Recommendation or formal winner merely to finish the Run.

## 12. Restart and reconnect

Process restart should reconstruct from committed durable state:

- Conversation/USER provenance;
- Intent;
- Knowledge/provenance;
- Recommendation and ConversationReference;
- Resource/action state;
- Authorization;
- ExecutionReceipt/Verification;
- operational task/Run/checkpoint state still required to continue safely.

Reconnect is a read/reconstruction operation, not a client-state replay into authority.

## 13. Stale work

A completed result is stale when its controlling basis changed before acceptance, including applicable:

- Run epoch;
- Intent;
- Knowledge request/checkpoint;
- Recommendation/action basis;
- ActionProposal version;
- subject/deletion state;
- capability version/policy.

Stale attachment is rejected. A late result is not automatically reinterpreted for successor state.

## 14. Provider/model degradation

Degradation is scoped to the affected capability/route/outcome.

A fallback is valid only when the substitute remains qualified for the exact role and preserves:

- semantic contract;
- data/privacy boundary;
- provenance;
- permissions/side effects;
- truth/admission requirements;
- authorization requirement;
- verification expectations.

Provider availability is never authority to weaken Product standards.

## 15. PostgreSQL/runtime recovery

Preserve existing durable mechanisms:

- transaction commit as durability boundary;
- CAS/version predicates;
- unique identities/fingerprints;
- immutable accepted results;
- lease reclaim;
- bounded retries;
- reconnect from committed state;
- no assumption that unknown/uncommitted state succeeded.

## 16. Product-visible reliability states

Keep inability/failure separate from normal lifecycle states.

Examples:

```text
TEMPORARILY_UNAVAILABLE
RESULT_AMBIGUOUS
INSUFFICIENT_KNOWLEDGE
UNSUPPORTED_CAPABILITY
INTEGRITY_FAILURE

RECOVERY_IN_PROGRESS
ACTION_REQUIRED_TO_CONTINUE
REQUEST_SUPERSEDED
CANCELLED
```

Exact enums are implementation work. The semantic distinction is normative.

## 17. Observability

Observability is diagnostic/projection state, not authority or the sole recovery ledger.

It should answer:

- what logical work/action was attempted;
- exact basis/subject/capability;
- attempts/leases/routes;
- accepted result identity;
- retry/recovery reason;
- ambiguity;
- stale/duplicate rejection;
- user impact;
- Verification status/availability when relevant.

Do not require raw user/provider content by default. Do not store secrets in diagnostic events.

## 18. Deletion and late work

Deletion/subject unavailability is a hard boundary:

1. deny new dispatch;
2. best-effort cancel in-flight work;
3. reject late Product release;
4. preserve only separately governed recovery/retention state;
5. never let a late provider success override deletion.

## 19. What reliability must never do

Reliability must never:

- turn retry into duplicate USER meaning;
- accept stale output into successor state;
- bypass Knowledge Trust because research is unavailable;
- silently switch to an unqualified provider;
- suppress required route provenance;
- treat timeout as proof of non-execution;
- resolve action ambiguity from telemetry/model inference alone;
- bypass Authorization;
- treat ExecutionReceipt as Verification;
- serve stale actionable Resource data as current;
- use telemetry as the sole record of Product success, retry permission, authorization, deletion, or verification.

## 20. Current implementation alignment

The baseline already demonstrates durable asynchronous Runs, PostgreSQL orchestration, leases/attempts, exact capability binding, cancellation/timeouts, operation identity, idempotent reuse, ambiguous non-idempotent protection, subject isolation, reconnectable Product state, and V36 separation of research execution from factual admission.

OD-011 mainly changes the Product objects those mechanisms protect upward; the sound reliability mechanisms should be reused rather than replaced.

## 21. Validation direction

Later exact-revision acceptance should include:

- duplicate request/task/action suppression;
- worker/API/PostgreSQL restart;
- stale Intent/Knowledge/action result rejection;
- provider outage and qualified fallback;
- research failure remaining non-evidence;
- deletion during in-flight execution;
- ambiguous consequential completion with no blind retry;
- ExecutionReceipt persisted without false Verification;
- independent status read establishing Verification when available;
- reconnect restoring ConversationReference/governed state without client authority;
- privacy-safe observability unable to alter recovery outcome.
