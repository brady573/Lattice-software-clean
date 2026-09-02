# M5-J — Bounded Material Correction to Run Supersession

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority basis: Owner-confirmed OD-004 and the canonical living-design v0.6 amendment.

## Product-observable slice

M5-J connects one later explicit USER correction in the bounded laptop journey to the existing immutable Intent Authority correction lineage and exact-version-bound Run supersession path.

After the M5-I journey has produced a confirmed laptop IntentVersion and an exact IntentVersion-bound Run, the bounded correction grammar is:

`Actually, make the budget $1,100.`

The USER correction is persisted first as append-only USER provenance. Intent Authority then applies a `CORRECTION` successor against the earlier price-setting IntentVersion while preserving the confirmed battery requirement and all historical IntentVersions.

If the bound predecessor Run is still non-terminal, the API-control supersession path cancels that historical attempt and creates a fresh pending successor Run bound to the new exact corrected IntentVersion. The predecessor Run remains bound to its historical IntentVersion. No truth, decision, explanation, evidence, or validation state is copied into the successor.

## Authority boundaries

- The correction is authoritative only because it is explicit persisted USER-origin meaning.
- The correction targets the earlier semantic change that established `price.max.usd`; it does not rewrite that historical version.
- Historical Run binding remains immutable.
- The successor Run binds the exact corrected `intentScopeId + intentVersionId`.
- Run supersession does not transfer V36 evidence, Decision Engine results, Product validation, or production-readiness claims.
- Unsupported correction language fails closed before USER provenance is appended or canonical intent changes.
- The bounded route does not generalize materiality classification, arbitrary correction interpretation, conditional corrections, cross-scope correction, or generalized conversational persistence.

## Idempotency and freshness

The bounded USER correction has stable message/turn provenance and a deterministic correction transition identity. Replaying the same logical USER correction reproduces the committed correction disposition and the same deterministic successor Run/supersession identity.

The predecessor Run is re-read immediately before supersession and its observed status/version is used for optimistic Run CAS. A concurrent Run transition can still make the supersession stale; that fails closed rather than moving a historical binding.

## Validation target

The dedicated memory and PostgreSQL regression must demonstrate:

1. the third bounded USER message is persisted with exact USER provenance;
2. a new immutable IntentVersion is created with `CORRECTION` lineage targeting the original price-setting version;
3. the predecessor Run remains bound to the earlier confirmed IntentVersion and becomes `CANCELLED`;
4. the successor Run is fresh `CREATED` state bound to the corrected exact IntentVersion;
5. the successor request reflects the corrected budget while preserving the confirmed battery requirement and performance preference;
6. immutable Run supersession lineage records old/new exact IntentVersion IDs;
7. replay returns the same successor Run and supersession identity;
8. unsupported bounded correction text cannot mutate intent or supersede a Run.

PostgreSQL validation must execute on the exact candidate revision before durability is claimed.

## Explicit non-goals

This slice does not implement generalized natural-language correction interpretation, generalized materiality classification, automatic correction of a Run that has already reached a terminal state, cross-aggregate transactional unification of IntentVersion commit and Run supersession, generalized M7 conversation persistence, authentication/privacy completion, live providers, or production deployment/readiness.
