# M5-G — Authoritative API-Control Run Supersession

Status: BOUNDED IMPLEMENTATION NOTE — NON-AUTHORITATIVE

Authority basis: Owner-confirmed OD-004. Implementation baseline: `main @ 0558296190041b5c90b5f54dbdaea794915bb6c4`.

## Implemented slice

M5-G carries the M5-F immutable Run-supersession contract through the same `ApiRunControlStore` mutation boundary used for authoritative exact-IntentVersion Run intake.

The control contract now accepts an explicit supersession command containing the predecessor Run CAS state, a fresh canonical successor Run, the successor exact `intentScopeId + intentVersionId`, and successor dispatch intent.

Memory composition delegates semantic lineage to `MemoryIntentBoundRunStore`; the deferred runtime wrapper schedules successor execution only when supersession is newly committed, never on replay.

PostgreSQL performs predecessor lock/CAS cancellation, cancellation event append, fresh successor creation, exact successor binding, immutable `run_supersessions` insertion, and successor `dispatch_outbox` insertion in one transaction. Invalid exact successor binding rolls the whole operation back. Replaying the same stable supersession identity returns the already-created successor without emitting a second dispatch.

## Authority boundary

This slice does not decide that a USER message is a correction, decide correction materiality, or create the corrected IntentVersion. It consumes already-established Product-authoritative exact IntentVersion identity and an explicit supersession command.

Legacy raw `RunRequest` intake remains non-authoritative and is not promoted by this change.

## State-transfer boundary

No predecessor `StructuredDecision`, truth snapshot, V36 conclusion, evidence admission, Product validation result, or explanation is copied to the successor. The successor begins as a fresh canonical pending Run bound to its new exact IntentVersion.

## Deferred work

- wiring an authoritative correction/confirmation flow to issue the supersession command automatically when OD-004 material-correction criteria are met;
- explicit non-material correction continuation behavior;
- any evidence reuse/admission policy across superseded Runs;
- generalized conversation persistence, delegation, cross-scope reuse/composites/synchronization;
- generalized M5 Product acceptance or production readiness.
