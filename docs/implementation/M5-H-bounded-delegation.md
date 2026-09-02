# M5-H — Explicit Bounded Preference Delegation

Status: bounded implementation slice for confirmed OD-004 Intent Authority semantics.

## Authority

This slice is bound to the Owner-confirmed `docs/design/Lattice-Owner-Decisions-OD-001-to-OD-004.md` delegation semantics and the v0.6 living-design amendment.

OD-004 requires delegation to be explicit USER intent, scoped, revocable, provenance-bound, and distinct from ordinary preference values. Ordinary bounded delegation does not grant final-choice authority; Decision Engine delegated selection remains a later M6 concern.

## Implemented contract

- `DELEGATED` is a distinct canonical intent value state.
- `DELEGATED` may be committed only on a `PREFERENCE` path, so the delegation grant is bounded by exact preference dimension and exact IntentScope/IntentVersion lineage.
- The existing transition pipeline retains USER provenance, exact base/version binding, idempotency, freshness/CAS behavior, semantic no-op handling, and immutable successor history.
- Repeating the same delegation is a semantic no-op rather than version churn.
- A later USER-authored preference value or removal revokes/replaces the bounded delegation through an ordinary immutable successor transition.
- Attempts to delegate an objective or hard requirement fail closed as invalid transitions.

## Explicit exclusions

This slice does not implement:

- final-choice delegation or `DelegatedSelection`;
- persistent final-choice delegation across materially changed decision states;
- cross-scope delegation transfer;
- newly discovered-criterion inclusion rules;
- conditional intent;
- cross-scope reuse, composites, synchronization, or scope lifecycle;
- interpretation of natural-language phrases such as `use your judgment`;
- any external action, purchase, or transaction authority.

Those remain separate bounded Product work.

## Validation intent

Targeted regression verifies explicit preference delegation, USER provenance, semantic no-op reaffirmation, revocation, and fail-closed non-preference delegation. The repository `npm run check` gate remains required on the exact candidate revision before bounded verification can be claimed.
