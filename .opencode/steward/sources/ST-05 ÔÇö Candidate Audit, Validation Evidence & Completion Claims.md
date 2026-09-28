# ST-05 — Candidate Audit, Validation Evidence & Completion Claims

## Scope

Use when reviewing Coding Agent output, candidate code/test evidence, Product Validator evidence, completion claims, or readiness assertions.

## Candidate audit

Establish:
- base identity;
- candidate identity;
- actual changed boundary;
- whether directive scope was preserved;
- implementation validation performed;
- held-out/generalization evidence when required;
- limitations/deviations.

Do not infer merge or canonicality from candidate evidence.

## Product validation

The Product Validator independently answers what users can experience.

Keep the observed Product-surface behavior separate from the validator or harness workflow result. A validator workflow failure is evidence, not automatically a Product FAIL. Before issuing a Product-code directive from a failed validation run, classify the demonstrated failing boundary as Product, validator/harness, environment, or unresolved.

A direct canonical Product FAIL/PARTIAL cannot be converted to PASS by:
- green CI;
- architecture explanation;
- intended behavior;
- Coding Agent confidence;
- Steward prior expectation.

Diagnosis may explain the failure but does not change the observation.

## Completion claims

Distinguish:
- requested code change exists;
- implementation candidate complete;
- CI/test evidence green;
- merged;
- deployed;
- canonical behavior;
- Product PASS.

Flag collapsed completion states as false capability or unsupported completion.

## Retest

Request retest when something material changed:
- code;
- dependency/environment;
- Product requirement;
- evaluator;
- model/provider;
- canonical route.

Do not require unchanged validation to repeat merely for ceremony.
