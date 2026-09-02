# M6-F Exact-Bound Delegated Selection

## Status

Bounded implementation slice for M6-F. It validates and materializes a Decision Engine `DelegatedSelection` without changing Intent Authority or granting external-action authority.

## Baseline and authority

- Canonical baseline: `main` at `941c19468bbaac9dc2615c71d803e71946434e58`.
- Product authority: Owner-confirmed OD-003 and OD-004.
- Execution boundary: `docs/implementation/M6-execution-handoff.md`.

## Implemented contract

A delegated selection requires:

- explicit `FINAL_CHOICE` authorization projected from Intent Authority;
- `EXPLICIT_USER` or exact `USER_CONFIRMED` provenance;
- active, non-revoked authority;
- exact `intentScopeId + intentVersionId` binding;
- exact decision-state and frontier-fingerprint binding;
- a non-empty, intact material-dominance frontier;
- a Decision-Engine-authored proposal selecting an alternative inside that frontier;
- structured reason criteria and acknowledged trade-offs.

The resulting `DelegatedSelection` preserves every frontier alternative, identifies Lattice Decision Engine as judgment authority, and records `externalActionAuthorized: false`.

## Fail-closed boundaries

The selector rejects:

- ordinary bounded preference delegation used as final-choice authority;
- revoked delegation;
- stale IntentVersion, decision-state, or frontier binding;
- cross-scope authority;
- selection outside the valid frontier;
- empty or forced-winner frontiers;
- proposals not attributed to Lattice Decision Engine.

## Explicit exclusions

This slice does not interpret USER language, commit Intent Authority state, persist selection, implement persistent delegation across material changes, perform external actions, purchase anything, transact, or generalize Solandra presentation.

M6 acceptance remains a separate exact-revision Product-observable trace.
