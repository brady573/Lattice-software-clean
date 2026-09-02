# M6 Lattice Decision Engine Acceptance

Status: candidate acceptance record; authoritative completion requires the exact candidate revision to pass the repository validation gate and merge without stale evidence.

## Bound baseline

- Starting canonical revision: `main @ 671ae5089db47b278273b6223fb129afe357538b`.
- Product authority: Owner-confirmed OD-003 and applicable OD-004 delegation boundaries.
- Accepted implementation slices under test: M6-A through M6-F.

## Product-observable acceptance trace

The executable `test/m6-decision-engine-acceptance.test.ts` trace exercises one coherent generalized decision:

1. Resolve exact typed/versioned criteria from the qualified Criterion Catalog.
2. Evaluate tri-state hard requirements and prove that `UNKNOWN` cannot satisfy eligibility.
3. Compare admitted numeric values using criterion meaningful-difference semantics plus exact-IntentVersion USER tolerance.
4. Preserve preference coverage independently and route an evidence gap to V36 without converting unknown utility to zero.
5. Exclude an ineligible alternative and construct the material-dominance frontier.
6. Preserve two credible alternatives when same-tier meaningful advantages conflict.
7. Produce no forced number-one result.
8. Under active exact-bound USER final-choice delegation, materialize a Decision-Engine-authored selection from the intact frontier.
9. Preserve structured reasons/trade-offs and explicitly deny external-action authority.

## Authority trace

- Intent Authority supplies exact USER scope/version tolerance and final-choice permission.
- V36 remains owner of admitted evidence and evidence-gap resolution.
- Criterion Catalog supplies qualified domain semantics.
- Lattice Decision Engine owns eligibility, material comparison use, frontier, and authorized delegated selection.
- Solandra presentation is not generalized or exercised by this milestone.
- No provider, deployment, purchase, action, or transaction is authorized.

## Acceptance boundary

Passing the targeted trace plus Windows, Android, and PostgreSQL repository CI on the exact candidate establishes bounded M6 Product acceptance for the implemented generalized Decision Engine contracts. It does not establish production readiness, live-provider qualification, generalized natural-language coverage, Solandra 1.0 explanation, authentication/privacy, or release acceptance.
