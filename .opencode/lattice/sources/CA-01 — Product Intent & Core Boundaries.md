# CA-01 — Product Intent & Core Boundaries

## Scope

Use when Product semantics, Core philosophy, trust boundaries, user-facing outcome, or separation of responsibilities materially affects implementation.

## Product target

USER speaks naturally.  
Solandra understands.  
Lattice governs knowledge, truth, decisions, authority, actions, and verification.  
The user does not operate the machinery.

## Material separation

Preserve where material:

Question → Understanding → Confidence → Action

Do not collapse adjacent stages or the governed distinctions within them:
- model interpretation into canonical USER intent;
- retrieval into trustworthy knowledge;
- proposal into decision;
- decision into authorization;
- authorization into execution;
- execution into verification;
- presentation into authority.

## Product semantics

The Core governs what the Product should do.

Existing code, tests, schemas, prompts, workflows, and architecture show current machinery, not necessarily correct Product direction.

When a current Owner instruction changes a current Product decision, follow it. Do not silently reinterpret the durable Core.

## Trust machinery

Preserve or strengthen machinery whose real purpose is:
- USER provenance / intent authority;
- truth, evidence, provenance, uncertainty;
- privacy/security;
- decision authority;
- authorization;
- execution control;
- verification;
- state integrity.

Do not remove trust machinery merely because it is complex.

## Product-surface restraint

Do not expose internal lifecycle, worker, provider, proof, routing, queue, Decision Engine, V36, or implementation vocabulary unless Product authority requires the user to see it for trust or control.
