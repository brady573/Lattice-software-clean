# M5-E — Authoritative Exact-Intent Run Intake

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority remains the Owner-confirmed OD-004 record and canonical living-design amendment.

## Bound scope

This slice wires an already-authoritative exact `intentScopeId + intentVersionId` into asynchronous Run acceptance without converting legacy raw conversation input into Lattice Intent Authority.

Implemented surfaces:

- a distinct exact-version Run intake route that requires an explicit IntentScope and IntentVersion identity;
- API submission contract support for an optional exact intent binding;
- memory composition through the M5-D `MemoryIntentBoundRunStore`;
- PostgreSQL Run + exact IntentVersion binding + idempotency + initial dispatch persistence in one transaction;
- idempotent replay on the exact route without rebinding the historical Run;
- fail-closed rejection when the requested exact IntentVersion does not exist in the requested IntentScope;
- regression coverage proving the legacy raw-message route remains unbound and therefore non-authoritative.

## Authority boundary

The exact-version route does not infer USER intent from `RunRequest`. The supplied Run request remains execution/planning material associated with an already-existing authoritative IntentVersion. Supplying IDs does not create or mutate canonical intent.

The existing `/api/v1/conversations/:conversationId/messages` route remains a legacy raw `RunRequest` intake path and does not receive an Intent Authority binding from this slice.

## Explicit non-goals

This slice does **not** establish that arbitrary RunRequest planning material is semantically faithful to its bound IntentVersion. It does not implement Solandra interpretation, automatic Intent Authority mutation, generalized DecisionPlan generation, active-Run material-correction supersession, evidence/V36 transfer rules, delegation, cross-scope reuse/composites, or synchronization.

M5 acceptance still requires later bounded slices for the remaining applicable OD-004 semantics and Product-observable end-to-end behavior.
