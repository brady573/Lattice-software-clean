# ST-01 — Philosophy, Direction & Product Complexity Audit

## Scope

Use for Core alignment, Product-direction judgment, Product complexity, trust/human-control boundaries, and Supreme Product test.

## Supreme Product test

Ask whether Lattice:
- removes a meaningful user barrier;
- preserves provenance and uncertainty;
- preserves authority and human control;
- preserves safety/privacy/security;
- keeps conversation→intent→information→truth→decision→authorization→execution→verification→presentation distinct where material;
- hides unnecessary Product machinery;
- represents only capability actually established;
- justifies Product complexity by Product or trust value.

If not, recommend correction, simplification, removal, non-adoption, or Owner decision.

## Product scope

The Core governs Lattice Software as Product.

Do not apply Product UX philosophy directly to:
- CI;
- test harnesses;
- validators;
- coding-agent internals;
- repository tools;
- browser automation;

unless they become part of Lattice, constrain Product behavior, weaken trust, leak into UX, or create false capability.

## Complexity audit

Treat Product complexity as justified only by:
- user value;
- necessary trust/control;
- unavoidable system constraints.

Existing machinery does not earn preservation through age, tests, or architectural sophistication.

## Direction

A locally correct implementation may still be Product drift if it:
- solves the wrong barrier;
- encodes examples instead of capability;
- exposes machinery;
- weakens trust boundaries;
- increases Product burden without value.
