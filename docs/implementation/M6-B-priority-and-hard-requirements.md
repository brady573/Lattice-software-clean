# M6-B — Priority Tiers and Tri-State Hard Requirements

Status: bounded implementation note; not independent requirement authority or validation evidence.

Bound baseline: `main @ 15d108c6ebc73a6bd7dd7dfc6fd39179dd46b231`.

Authority basis: Owner-confirmed OD-003 and `docs/implementation/M6-execution-handoff.md`.

## Product slice

M6-B introduces the confirmed four-tier vocabulary in authoritative order:

1. `MUST_HAVE`
2. `MATTERS_MOST`
3. `IMPORTANT`
4. `NICE_TO_HAVE`

It also introduces typed hard requirements and the exact tri-state result:

- `SATISFIED`
- `FAILED`
- `UNKNOWN`

Missing or non-comparable admitted values remain `UNKNOWN`. Eligibility is permitted only when every evaluated hard requirement is `SATISFIED`; `UNKNOWN` is never converted to zero, failure, or satisfaction.

## Authority boundaries

This slice evaluates a supplied admitted value against a typed predicate. It does not admit evidence, decide research sufficiency, infer USER priority/tolerance, apply meaningful-difference semantics across priority tiers, score candidates, or compute the material-dominance frontier.

V36 remains responsible for evidence admission and research judgment. Intent Authority remains responsible for USER priorities and tolerances. Existing prototype scoring and `StructuredDecision` behavior remain unchanged until a later bounded integration slice.

## Acceptance criteria

- all four OD-003 priority tiers exist in controlling order;
- numeric LTE/GTE and typed equality produce deterministic `SATISFIED | FAILED`;
- missing and non-comparable values produce `UNKNOWN`;
- `UNKNOWN` cannot permit eligibility;
- invalid requirement identities fail closed;
- targeted and aggregate repository validation pass on the exact candidate revision.
