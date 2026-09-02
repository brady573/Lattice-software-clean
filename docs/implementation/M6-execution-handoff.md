# M6 — Lattice Decision Engine Execution Handoff

Status: historical/completion coordination record; not independent Product authority, validation, acceptance, or production readiness.

Original bound baseline: `main @ 4c98116a9534a68cb2d41954f2a22af304f0c194`.
Acceptance Work Item baseline: `main @ 671ae5089db47b278273b6223fb129afe357538b`.

## Qualified Product authority

- Owner-confirmed OD-003 in `docs/design/Lattice-Owner-Decisions-OD-001-to-OD-004.md`.
- Applicable OD-004 exact USER delegation boundaries.
- Canonical living design and v0.6 amendment.
- `docs/design/Lattice-Architecture-Integrity.md`, especially AIC-01, AIC-03, and AIC-05.
- Stabilized M5 Intent Authority contracts and exact IntentVersion/Run binding.

External candidates, older handoffs, and this record do not independently authorize Product semantics.

## Stabilized upstream surfaces consumed by M6

- Immutable, versioned Intent Authority state with explicit USER provenance.
- Exact `intentScopeId + intentVersionId` binding for DecisionPlan and Run.
- Explicit bounded preference delegation and separate final-choice delegation semantics.
- Material clarification, correction lineage, and Run supersession without moving historical bindings.
- V36 ownership of evidence admission, uncertainty, and evidence-gap resolution.

## M6 objective

Generalize the single authoritative Lattice Decision Engine under OD-003 while preserving V36 truth authority, Intent Authority ownership of USER meaning/tolerance/delegation, and Solandra's presentation-only boundary.

## Completed bounded slices

1. M6-A — qualified typed/versioned Criterion Catalog.
2. M6-B — four authoritative priority tiers and tri-state hard-requirement evaluation.
3. M6-C — layered meaningful-difference/tolerance evaluation with authority ownership preserved.
4. M6-D — separate unknown utility from coverage and authority-correct gap routing.
5. M6-E — material-dominance frontier with structured reasons/trade-offs and no forced #1.
6. M6-F — explicit exact-bound delegated selection from the intact valid frontier.
7. M6 acceptance — executable Product-observable trace across the generalized bounded domain.

Each slice retained its own exact candidate validation evidence and merge transition. Validation evidence does not silently transfer across revisions.

## M6 acceptance criteria

- Exact typed/versioned criterion lookup fails closed when unqualified.
- Hard requirements remain `SATISFIED | FAILED | UNKNOWN`; only satisfied requirements permit eligibility.
- Higher tiers dominate lower tiers only on meaningful differences under qualified tolerance.
- Criterion meaningful difference remains distinct from exact-IntentVersion USER tolerance.
- Unknown utility remains unknown and separate from coverage.
- Evidence gaps route to V36, intent gaps to Intent Authority, and irresolvable gaps to explicit limitation.
- The authoritative recommendation set is a material-dominance frontier with structured reasons/trade-offs and no forced #1.
- Final selection occurs only under active exact-bound USER final-choice delegation, preserves the frontier, and grants no external-action authority.
- The generalized executable acceptance trace and repository Windows, Android, and PostgreSQL gates pass on the exact acceptance candidate.

## Remaining boundaries

M6 does not establish live-provider qualification, production deployment/readiness, generalized natural-language interpretation, durable conversation authority, authentication/privacy, Solandra 1.0 explanation, external action authority, or release acceptance. Those remain with later milestones and unresolved Owner decisions where applicable.
