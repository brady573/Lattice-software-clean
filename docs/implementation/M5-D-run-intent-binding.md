# M5-D — Exact Run to IntentVersion Binding Substrate

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority remains the Owner-confirmed OD-004 record and canonical living-design amendment.

## Bound scope

This slice establishes a first-class immutable exact `intentScopeId + intentVersionId` binding substrate for Runs without treating the current legacy raw `RunRequest` HTTP intake as authoritative structured intent.

Implemented surfaces:

- memory exact-binding composition against an existing Lattice Intent Authority version;
- atomic PostgreSQL Run creation plus exact binding persistence;
- composite database foreign-key enforcement that prevents an IntentVersion from being paired with the wrong IntentScope;
- runtime migration composition for the binding table;
- regression coverage proving a historical Run binding does not move when the IntentScope head advances.

## Explicit non-goals

This slice does **not** claim that every existing Run intake path is yet Intent Authority-backed. The current legacy raw-request endpoints remain unchanged and therefore do not earn the OD-004 downstream-binding acceptance criterion from this substrate alone.

A subsequent M5 slice must wire authoritative Intent Authority intake/planning to this binding boundary before generalized Run creation can be described as exact-version bound end to end.
