# CV-01 — Correctness, Reliability & Change Impact

## Scope

Use when validation materially depends on implementation correctness, state behavior, regression risk, reliability, performance correctness, concurrency, lifecycle, persistence, or tests.

## Change-impact review

For a bounded change, inspect beyond changed lines whenever behavior can propagate through:

- callers and callees;
- interfaces and contracts;
- state transitions;
- persisted schemas or serialization;
- queues/events/callbacks;
- caches;
- lifecycle ownership;
- configuration and feature flags;
- concurrency boundaries;
- error/retry paths;
- tests and fixtures;
- dependency or platform assumptions.

Do not expand into unrelated architecture merely because it is nearby.

## Correctness lenses

Apply only the lenses material to the candidate.

### Control flow

Check normal, exceptional, cancellation, timeout, retry, fallback, and cleanup paths. Look for impossible or missing branches, inverted conditions, early-return side effects, and partial completion.

### Data flow and invariants

Trace where material data originates, is transformed, validated, persisted, transmitted, and consumed. Identify invariants the code assumes and verify that each entry path establishes them.

### State and continuity

Check initialization, mutation, invalidation, successor state, stale state, rollback, idempotency, duplicate delivery, and restart/recovery behavior where relevant.

### Ownership and lifecycle

Check resource acquisition/release, subscriptions, file/socket/process handles, task cancellation, object lifetime, disposal, cleanup after failure, and ownership transfer.

### Concurrency

When shared mutable state, asynchronous operations, threads, tasks, actors, callbacks, events, or parallel jobs are involved, inspect:

- atomicity;
- ordering assumptions;
- races;
- deadlocks/livelocks;
- reentrancy;
- cancellation;
- lost updates;
- duplicate work;
- visibility/memory semantics;
- thread/actor affinity.

Do not infer runtime ordering guarantees from repository convention. Route material external semantics to `CV-03`.

### Persistence and serialization

When durable state or wire/storage formats change, check:

- backward/forward compatibility;
- migrations;
- defaults and missing fields;
- version skew;
- partial writes;
- transactional boundaries;
- corruption recovery;
- schema validation.

### Error handling and recovery

Check whether errors are detected at the correct boundary, whether failure is surfaced or swallowed, whether retries are safe, and whether recovery preserves invariants.

### Performance correctness

Treat performance as correctness when latency, throughput, memory, frame time, resource ceilings, or scalability are part of the requirement or when the implementation can fail operationally under plausible load.

Prefer measurements over intuition. Record workload and environment. Do not generalize microbenchmarks beyond what they establish.

## Tests

Tests are supporting evidence and regression protection.

Evaluate whether tests:

- exercise the changed behavior rather than implementation trivia;
- include failure and boundary cases;
- would fail for the defect being discussed;
- encode the same unverified assumption as the implementation;
- are deterministic enough for their claim;
- cover version/platform conditions that matter;
- protect remediation against recurrence.

Add or recommend held-out tests when existing fixtures may be overfit to the implementation.

A test suite passing does not negate a directly established defect outside its coverage.

## Dynamic evidence

Use reproduction, targeted instrumentation, sanitizer output, traces, benchmarks, fuzzing, or property-based testing when they materially reduce uncertainty.

Record commands/configuration and distinguish deterministic from intermittent results.

An unreproduced suspected defect remains `INFERRED` or `UNKNOWN` unless other evidence establishes it.

## Regression reasoning

For each material change ask:

1. What existing behavior can this alter?
2. Which invariants cross the changed boundary?
3. What previous callers/data/configurations may still reach the path?
4. What happens under failure, retry, cancellation, restart, or version skew?
5. What regression evidence would catch the most plausible failure?

## Output contribution

Provide finding evidence, impact, reproduction when possible, remediation constraints, and verification requirements to `CV-04`.
