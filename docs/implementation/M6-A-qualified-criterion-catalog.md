# M6-A — Qualified Criterion Catalog Foundation

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority basis: Owner-confirmed OD-003 and the M6 execution handoff reconciled to `main @ 4c98116a9534a68cb2d41954f2a22af304f0c194`.

## Product slice

M6-A introduces the first isolated Decision Engine generalization substrate: an immutable qualified Criterion Catalog with typed, versioned `CriterionDefinition` records.

The catalog supports:

- explicit catalog version identity;
- exact `criterionId + definition version` resolution;
- an explicit latest-version discovery view without replacing exact lookup;
- bounded value and preference-direction types;
- criterion-owned absolute meaningful-difference metadata;
- fail-closed rejection of invalid, duplicate, empty, or unknown qualified definitions.

## Authority boundaries

This slice does not admit evidence, infer USER priorities, apply user-specific tolerance, score candidates, evaluate hard requirements, compute a frontier, or select a winner. V36 remains evidence authority; Intent Authority remains USER intent/tolerance/delegation authority; later bounded Decision Engine slices will consume the catalog.

Existing `RunRequest`, prototype scoring, `StructuredDecision`, and Solandra behavior remain unchanged.

## Validation target

Targeted regression and the aggregate repository gate must demonstrate exact-version resolution, immutability, duplicate rejection, unknown-definition failure, and bounded type semantics on the exact candidate revision.
