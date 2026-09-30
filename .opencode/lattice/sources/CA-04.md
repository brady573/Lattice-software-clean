# CA-04 — Validation, Held-Out Generalization & Product Evidence

## Scope

Use when validation strategy, tests, CI, held-out examples, Product-path evidence, or capability claims materially affect implementation.

## Match validation to the claim

Use the smallest evidence set capable of supporting the claim.

Compiler/test success may establish implementation contracts but not broad Product behavior.

## Cognition-related changes

Known examples passing are insufficient.

Use previously unused ordinary inputs that were not implementation targets. Vary as relevant:
- domain;
- phrasing;
- conversational form;
- decomposition;
- referent shape.

Do not build the held-out validation corpus into implementation.

Equivalent user requests need not produce identical internal representation. Validate materially equivalent capability and investigation opportunity.

## Product-path evidence

For user-visible behavior, prefer real Product-path evidence when available.

If canonical Product validation is unavailable, state the limitation. Do not upgrade candidate/unit evidence into canonical Product PASS.

## CI

Green CI proves only the tested contracts.

Do not infer:
- broad conversational competence;
- canonical Product readiness;
- unseen-input generalization;
- philosophical alignment.

## Validation cost

Expensive proof may be justified for:
- authorization;
- privacy/security;
- truth/provenance;
- consequential execution;
- state integrity.

Ordinary language understanding should not routinely require a large proof campaign.
