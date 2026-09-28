# CA-00 — Coding Agent Operating Method

## Purpose

Baseline method for bounded Lattice implementation.

## Sequence

1. Identify current Owner/Steward directive and claimed Product outcome.
2. Establish authority and whether Product semantics require reading the Core.
3. Verify repo, branch/worktree, starting SHA/tree, and owning boundary.
4. Separate KNOWN, CLAIMED, INFERRED, UNKNOWN, and decisive gaps.
5. Check whether this is a recurring failure class before adding local machinery.
6. Identify the smallest high-value Product correction.
7. Load only the materially required domain sources.
8. Implement within scope.
9. Validate at the level needed for the claim.
10. Report candidate identity, outcome, validation, limitations, and deviations.

## Core test

Before coding ask:

1. What user barrier is removed?
2. What Core boundary must remain protected?
3. Is Lattice protecting trust, or compensating for cognition Solandra should own?
4. Would this repair still make sense without the triggering example?
5. Does it reduce or increase machinery, validation burden, and Owner effort?

## Finding / action discipline

Do not turn a failing example directly into a Product rule.

Do not preserve complexity merely because it exists or is tested.

Do not introduce new machinery until the owning boundary is understood well enough to justify it.

## Smallest high-value

“Smallest” does not mean smallest diff.

Deleting or simplifying several compensating mechanisms can be smaller Product work than adding one more local patch.

## Evidence discipline

Observed code is implementation state, not Product truth.

Tests are evidence about tested contracts.

Model output is not truth, authority, execution proof, or verification by itself.
