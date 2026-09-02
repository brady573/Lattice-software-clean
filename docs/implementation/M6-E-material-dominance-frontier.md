# M6-E Material-Dominance Frontier

## Status

Bounded implementation slice for M6-E. It constructs a conservative valid frontier but does not perform delegated selection or claim M6 acceptance.

## Baseline and authority

- Canonical baseline: `main` at `4f6d5621633181ca5338ed92c9d1e3590983a76a`.
- Product authority: Owner-confirmed OD-003.
- Execution boundary: `docs/implementation/M6-execution-handoff.md`.

## Implemented semantics

- Only alternatives with explicit `ELIGIBLE` state enter the frontier calculation.
- `INELIGIBLE` and eligibility-`UNKNOWN` alternatives remain separately reported.
- Pairwise dominance is decided at the highest priority tier containing a meaningful difference.
- A one-sided material advantage at that tier dominates lower-tier differences.
- Conflicting material advantages within the same tier remain an explicit trade-off and preserve both alternatives.
- Unknown comparison state at a higher tier blocks lower-tier dominance.
- Missing comparison data preserves both alternatives rather than inventing a ranking.
- The result always sets `forcedWinnerAlternativeId` to `null`.

Each pairwise result records its decisive tier, reason, material advantages, same-tier trade-offs, and unresolved criterion versions.

## Authority boundary

The constructor consumes already-adjudicated eligibility and meaningful-difference results. It does not:

- admit or assess evidence;
- create epistemic verdicts;
- infer or mutate user intent or tolerance;
- resolve missing evidence or intent;
- choose a final alternative;
- perform delegated selection;
- generalize Solandra presentation.

Evidence admission remains with V36. USER meaning, tolerance, and delegation remain with Intent Authority. M6-F owns any explicitly authorized selection from the intact valid frontier.

## Acceptance criteria

- Higher-tier dominance applies only to meaningful differences.
- Same-tier trade-offs remain visible and nondominated.
- Unknown or missing comparisons cannot be treated as zero or silently ignored.
- Alternatives without satisfied eligibility cannot enter the valid frontier.
- No number-one result is forced.
- Invalid identifiers, duplicate alternatives or comparisons, and contradictory comparison states fail closed.
- Targeted tests and repository Windows, Android, and PostgreSQL CI pass on the exact candidate revision.
