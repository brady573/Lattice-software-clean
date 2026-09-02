# M6-D Preference Coverage and Gap Routing

## Status

Bounded implementation slice for M6-D. This note does not claim completion of M6 or production recommendation ranking.

## Baseline and authority

- Canonical baseline: `main` at `01930decadd7825ac07d12b5fadc79cf30eb2465`.
- Product authority: Owner-confirmed OD-003.
- Execution boundary: `docs/implementation/M6-execution-handoff.md`.

## Implemented semantics

Preference utility and coverage are separate outputs:

- Utility is either a known normalized value in `[0, 1]` or `null`.
- Unknown utility remains `null`; it is never converted to zero.
- Coverage is independently reported as `COMPLETE`, `PARTIAL`, or `NONE`.
- A result is ranking-stable only when utility is known, coverage is complete, and no unresolved gap remains.

Unresolved gaps route according to authority:

| Gap | Resolution owner |
| --- | --- |
| `EVIDENCE` | V36 |
| `INTENT` | Intent Authority |
| `IRRESOLVABLE` | Explicit limitation |
| `NONE` | None |

The evaluator fails closed on contradictory states, including unknown utility without an explicit gap, complete coverage with an evidence gap, and known utility with no coverage.

## Boundary

This slice performs no research or user clarification itself. It does not score alternatives, construct a dominance frontier, force a number-one result, or delegate selection. It only preserves the distinction between utility, coverage, and unresolved-gap ownership for later Decision Engine stages.

## Acceptance evidence

Targeted tests cover:

- known and unknown utility handling;
- utility/coverage separation;
- V36, Intent Authority, and explicit-limitation routing;
- ranking-stability conditions;
- contradictory-state rejection.

Repository CI remains the acceptance gate across Windows, Android, and PostgreSQL lanes.
