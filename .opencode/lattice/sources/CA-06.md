# CA-06 — Recurring Failure, Context & Anti-Churn

## Scope

Use when related prior repairs, repeated tests/actions, stale assumptions, context resets, retries, or duplicated work materially affects the task.

## Related repair check

Before repairing an ordinary-use defect, inspect available task history for materially related repairs.

Classify whether prior work addressed:
- the same example;
- the same symptom;
- the same failure mechanism;
- the same owning boundary.

Do not count unrelated bugs merely because they touch the same file.

## Two-repair trigger

After two materially related local repairs without convincing held-out generalization evidence, presume the owning Product boundary may be wrong.

This is a stop/escalation trigger, not proof of a particular replacement architecture.

## Anti-churn

Do not repeat materially identical work unless something capable of changing the result changed, such as:
- code/SHA;
- dependencies/environment;
- requirement;
- model/provider;
- evaluator;
- evidence freshness;
- failure hypothesis;
- Owner/Steward directive.

## Context continuity

Preserve:
- current authority;
- accepted evidence;
- starting/candidate identities;
- unresolved unknowns;
- rejected local-patch paths;
- stop conditions already triggered.

A context summary must not silently reauthorize a previously rejected scope or erase a governing constraint.
