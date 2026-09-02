# M6-C — Layered Meaningful-Difference Evaluation

Status: bounded implementation note; not independent requirement authority or validation evidence.

Bound baseline: `main @ f930218c1e9d662e4f1d8844f2aab08154f4eee4`.

Authority basis: Owner-confirmed OD-003 and `docs/implementation/M6-execution-handoff.md`.

## Product slice

M6-C adds a pure comparison boundary for admitted numeric criterion values while conserving the two confirmed tolerance authorities:

- the exact qualified `CriterionDefinition` supplies the domain minimum meaningful difference;
- an optional exact `intentScopeId + intentVersionId` projection supplies the USER's maximum tolerated difference.

A difference is authoritative as `MEANINGFUL` only when it is non-zero, meets the criterion-owned minimum, and exceeds any supplied USER tolerance. Otherwise it remains `WITHIN_TOLERANCE`. Missing, non-finite, or non-orderable inputs remain `UNKNOWN`.

The result preserves both thresholds and the exact IntentVersion binding instead of collapsing them into an untraceable score.

## Authority boundaries

The Decision Engine consumes but does not create or mutate either tolerance:

- Criterion Catalog owns criterion/domain meaningful-difference semantics.
- Intent Authority owns USER-specific tolerance and its exact version binding.
- V36 owns evidence admission, ability, and uncertainty.

This slice does not infer USER tolerance, admit evidence, compare priority tiers, score candidates, compute coverage, create a frontier, or select a winner.

## Acceptance criteria

- criterion-owned minimum differences gate material comparison;
- exact-IntentVersion USER tolerance is preserved separately and can keep a domain difference within tolerance;
- higher-is-better and lower-is-better direction select the correct preferred side only for meaningful differences;
- missing/non-finite/non-orderable inputs remain `UNKNOWN`;
- tolerance bound to another criterion/version fails closed;
- equal values never become meaningful;
- targeted and aggregate repository validation pass on the exact candidate revision.
