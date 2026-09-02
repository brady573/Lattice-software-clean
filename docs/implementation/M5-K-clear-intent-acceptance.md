# M5-K — Clear Intent Acceptance Slice

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority basis: Owner-confirmed OD-004 plus the canonical M5 exit gate in the living design.

## Product-observable slice

M5-K closes the remaining bounded M5 acceptance gap by demonstrating that an explicitly clear natural-language request can proceed directly into an exact IntentVersion-bound Run without material clarification.

The bounded grammar is equivalent to:

`I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.`

The USER message is persisted first as append-only USER provenance. Because the battery threshold is explicitly stated as a hard requirement, the bounded interpreter does not create a material clarification proposal. The initial immutable IntentVersion records the objective, price ceiling, battery hard requirement, and performance-over-battery preference with explicit USER provenance, and the existing API-control path creates a fresh Run bound to that exact `intentScopeId + intentVersionId`.

The response reports `clarificationRequired: false` and `RUN_ACCEPTED`.

## Acceptance relationship

This slice is only one part of the canonical M5 milestone gate:

- M5-K demonstrates that a clear bounded normal-language request proceeds directly.
- The existing bounded conversational-intake slice demonstrates material ambiguity entering clarification rather than execution.
- Existing immutable correction lineage plus M5-J demonstrate correction history and material correction Run supersession without moving historical bindings.
- Existing exact Run and DecisionPlan binding slices demonstrate downstream binding to exact confirmed IntentVersions.

Milestone acceptance still requires exact candidate validation and a final evidence trace; this document does not itself mark M5 complete.

## Authority boundaries

- Only persisted USER-origin meaning mutates the IntentVersion.
- No assistant/model interpretation becomes authoritative merely by being generated.
- Unsupported language fails closed before the bounded USER provenance ledger advances.
- This slice does not generalize natural-language interpretation beyond the explicit acceptance grammar.
- Existing Decision Engine criterion/priority semantics are not generalized here; current RunRequest normalization remains a bounded prototype representation.
- No M7 durable conversation authority, M8 authentication/privacy, live-provider activation, production deployment, or production-readiness claim is introduced.

## Idempotency and freshness

The USER source message uses stable turn/message/horizon provenance. The initial transition and successor Run identity are deterministic for the exact source and IntentVersion. API-control idempotency preserves same-request replay, while conflicting reuse fails closed.

## Validation target

Memory and PostgreSQL regression coverage must demonstrate:

1. exact USER source provenance is persisted before canonical intent mutation;
2. the clear request produces one complete initial immutable IntentVersion;
3. no material clarification is required for the bounded explicit hard requirement;
4. a Run is accepted and bound to that exact IntentVersion;
5. replay returns the same accepted Run and IntentVersion;
6. unsupported text cannot silently mutate canonical intent or create a Run;
7. PostgreSQL durability records the exact binding and dispatch on the exact candidate revision.
