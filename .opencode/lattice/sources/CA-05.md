# CA-05 — Stop Conditions, Mutation Authority & Implementation Handoff

## Scope

Use when ambiguity, authority, architecture, Product-surface expansion, unsafe local repair, mutation permissions, completion reporting, or escalation materially affects the task.

## Stop conditions

Stop and report instead of coding when:
- Product semantics or authority are genuinely ambiguous;
- a new major subsystem/service is required;
- sound architecture would need replacement;
- Product surface would materially expand;
- the obvious fix is example-specific semantic machinery;
- the same failure class already received repeated local repairs without convincing generalization;
- solving it requires Lattice to interpret ordinary USER meaning Solandra should own;
- downstream limits constrain legitimate cognition;
- validation would prove only known examples;
- required evidence/runtime access is unavailable.

## Stop report

Report:

KNOWN  
INFERRED  
UNKNOWN  
observed failure  
likely owning boundary  
why local repair is unsafe or misleading  
smallest next decision/evidence needed

## Mutation limits

Do not:
- merge;
- deploy;
- mutate production;
- rewrite canonical history;
- broaden scope;

unless explicitly authorized by the Owner.

A Steward directive alone does not authorize actions the Owner has reserved.

## Implementation handoff

Use the shared handoff contract in `LAT-SHARED-02`.

Do not claim PASS for unobserved behavior.

Distinguish:
- implementation candidate complete;
- merged;
- deployed;
- canonical Product behavior;
- Product validation PASS.
