# M5-I — Exact DecisionPlan IntentVersion Binding

Status: bounded implementation note; not independent requirement authority or validation evidence.

Authority remains the Owner-confirmed OD-004 record and canonical living-design amendment.

## Bound scope

This slice establishes the smallest planning prerequisite still explicit after M5-E: downstream `DecisionPlan` material can be bound to one existing exact `intentScopeId + intentVersionId` without converting planning material into Lattice Intent Authority.

Implemented behavior:

- `DecisionPlan` binding requires a non-empty plan identity and exact IntentScope/IntentVersion identity;
- the referenced IntentVersion must exist in the requested IntentScope;
- bound planning material is copied at bind time so later caller mutation does not rewrite the historical bound plan envelope;
- later IntentVersion successors never move an existing historical DecisionPlan binding;
- a later plan may explicitly bind a later exact IntentVersion.

## Authority boundary

This substrate does not interpret USER text, generate planning semantics, decide materiality, mutate canonical intent, classify correction, or establish that arbitrary planning material is semantically faithful to its bound IntentVersion. Exact binding is necessary provenance, not proof of planning correctness.

## Explicit non-goals

This slice does not implement generalized DecisionPlan generation, natural-language intake, scope lifecycle, cross-scope reuse/composites/synchronization, conversation persistence, Decision Engine semantics, V36 evidence transfer, or production readiness.

M5 acceptance still requires later Product-observable work for the remaining applicable planning and OD-004 behavior.
