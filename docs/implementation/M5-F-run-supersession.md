# M5-F — Active Run Material-Correction Supersession Substrate

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority remains the Owner-confirmed OD-004 record and canonical living-design amendment.

## Bound scope

This slice establishes immutable Run supersession lineage for an already-authoritative material correction after M5-E exact-version Run intake.

Implemented surfaces:

- exact predecessor Run binding is preserved permanently;
- successor Run must bind a different existing exact IntentVersion in the same IntentScope;
- predecessor state is CAS-checked and operationally cancelled when superseded;
- successor starts as a fresh canonical pending Run rather than inheriting prior decision or truth state;
- memory supersession is idempotent by stable supersession identity;
- PostgreSQL predecessor cancellation, successor creation/binding, and supersession lineage persist in one transaction;
- durable lineage is constrained against both predecessor and successor exact Run/Intent bindings;
- invalid successor IntentVersion rejection leaves the predecessor unchanged in PostgreSQL.

## Authority boundary

This substrate does not decide whether a USER change is material. The caller must already have an authoritative successor IntentVersion and a Product-owned determination that the correction requires a new decision attempt.

`CANCELLED` remains the existing operational terminal Run state. The distinct semantic reason that this cancellation replaced a decision attempt is carried by immutable `run_supersessions` lineage rather than by reinterpreting ordinary user cancellation.

## Evidence-transfer boundary

No prior `StructuredDecision`, truth snapshot, V36 conclusion, research result, or Product validation is copied to the successor. Any later reuse requires a separately qualified and implemented rule; this slice earns no evidence-transfer acceptance.

## Explicit non-goals

This slice does **not** wire correction classification directly from conversation intake, automatically launch the successor through a correction API, define non-material correction continuation policy end to end, transfer evidence/V36 conclusions, implement delegation/cross-scope/composite/synchronization semantics, or establish generalized M5 acceptance or production readiness.
