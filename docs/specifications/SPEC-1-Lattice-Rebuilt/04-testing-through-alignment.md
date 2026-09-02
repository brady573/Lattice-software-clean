# 25. Testing Strategy

## 25.1 Unit tests

- Run state transitions and stale-CAS rejection.
- Task readiness and DAG cycle validation.
- Task fingerprint determinism.
- Hard-constraint elimination and score normalization.
- Evidence coverage and uncertainty adjustment.
- Decision sensitivity and explanation fidelity checks.
- Memory precedence.
- URL/IP security classification helpers.

## 25.2 Integration tests

Integration tests use real PostgreSQL, pg-boss, API, orchestrator,
outbox dispatcher, and worker, with deterministic fixture AI/research
providers. They must exercise process interruption and duplicate
delivery rather than only happy-path service calls.

## 25.3 Provider contract tests

- Structured output validation.
- Tool invocation mapping.
- Timeout/rate-limit/auth/provider-error normalization.
- Invalid output rejection.
- Usage and cost accounting.
- Fallback eligibility and attribution.

## 25.4 CI gates

- Format, lint, dependency-boundary lint, TypeScript compile.
- Unit tests.
- Migration-from-empty and migration-current-version tests.
- Integration tests.
- Security regression tests for authorization, SSRF, and file ownership
  boundaries.

# 26. Core Acceptance Tests

| **Scenario**                           | **Required result**                                                                                                                                                           |
|----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Run durability                         | Kill/restart worker and orchestrator during INVESTIGATING; the Run continues without duplicate accepted logical evidence.                                                     |
| Lost dispatch window                   | Crash after transition transaction commit but before queue enqueue; outbox dispatcher/reconciler eventually dispatches the intended logical work exactly once logically.      |
| Duplicate orchestration                | Deliver the same orchestrator wake-up concurrently to two replicas; one epoch transition wins and no duplicate logical downstream task is created.                            |
| Worker crash after provider completion | Crash after provider/tool completion but before result commit; retry persists exactly one accepted logical result.                                                            |
| Worker duplicate delivery              | Deliver the same task twice concurrently; accepted result/evidence is singular.                                                                                               |
| Cancellation race                      | Cancel during every active stage and concurrently with DECIDING; the terminal outcome follows the defined CAS winner and late worker results cannot mutate the cancelled Run. |
| Budget race                            | Concurrent schedulable tasks cannot reserve more than remaining Run budget.                                                                                                   |
| Deadline                               | No new external work begins after deadline; late completion follows declared admission policy.                                                                                |
| DAG validation                         | A multi-node cycle is rejected before plan activation.                                                                                                                        |
| Provenance isolation                   | Database/API cannot associate a claim from Run A with a source from Run B.                                                                                                    |
| Rejected claim safety                  | A rejected claim cannot appear as supported final evidence.                                                                                                                   |
| Constraint decision                    | A candidate violating a validated hard constraint cannot be selected.                                                                                                         |
| Decision fidelity                      | Explanation generation cannot alter persisted outcome/ranking/confidence/constraint status.                                                                                   |
| Authorization                          | User B cannot read or mutate any user-owned Run/conversation/event/result/source/file belonging to User A.                                                                    |
| SSE reconnect                          | Reconnect after event N returns N+1 onward in order; expired cursors produce an explicit resync response.                                                                     |
| Idempotency                            | Same key + same body converges; same key + different body returns conflict.                                                                                                   |
| SSRF                                   | Private/metadata addresses, redirect-to-private, IPv6 private ranges, and DNS-rebinding fixtures are rejected.                                                                |

# 27. Recommended Build Sequence

16. Repository + CI + dependency boundaries.
17. PostgreSQL schema and migrations.
18. Domain state machine and CAS transition repository.
19. Transactional outbox + pg-boss dispatcher.
20. Run/message API and SSE event persistence.
21. Orchestrator skeleton and reconciliation.
22. Fixture IntelligenceGateway + invocation audit.
23. Intent interpretation + progressive clarification.
24. Persisted planning + DAG validation + task fingerprinting.
25. Worker attempt/result idempotency.
26. ToolGateway and deterministic research fixtures.
27. Source, artifact, claim, and validation persistence.
28. Structured decision + basic sensitivity.
29. Explanation fidelity validation.
30. Security hardening: authz, SSRF, upload contracts.
31. Real OpenAI integration.
32. Real Anthropic integration/fallback.
33. Live web research providers.
34. Private object storage/files.
35. Persistent user/project memory.
36. Evaluation suite and raw-model baseline.
37. Production hardening, dashboards, backup/restore, rate limits.

# 28. Milestones

| **Milestone**               | **Deliverables**                                                                                                             | **Exit condition**                                                              |
|-----------------------------|------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| M1 Core Platform            | Monorepo, CI, PostgreSQL, migrations, API/orchestrator/worker, logging.                                                      | Clone/start/create/retrieve a persisted Run.                                    |
| M2 Durable Execution        | CAS state machine, outbox, pg-boss, task dependencies, attempts, retries, reconciliation, cancellation, budget reservations. | Crash, duplicate delivery, and concurrency acceptance tests pass.               |
| M3 Intelligence Boundary    | Gateway, fixture provider, provider registry, prompt/version metadata, invocation usage.                                     | Core integration tests run without live credentials.                            |
| M4 Intent and Planning      | Intent, priorities, clarification, persisted plans, DAG validation, capability registry.                                     | Normal-language requests produce preserved intent and bounded executable plans. |
| M5 Research and Provenance  | ToolGateway, source/artifact/claim/evidence persistence.                                                                     | Material facts resolve through same-Run source lineage.                         |
| M6 Validation               | Source quality, claim validation, contradictions, research gaps, stopping rule.                                              | Unsupported/contested material claims are surfaced and handled explicitly.      |
| M7 Structured Decisions     | Constraints, scoring, coverage, uncertainty, basic sensitivity, decision persistence.                                        | Decision is reproducible from persisted inputs.                                 |
| M8 Solandra Response        | Response view model, explanation, fidelity validation, evidence presentation.                                                | User explanation is faithful to the persisted decision.                         |
| M9 Realtime Experience      | SSE, reconnect/resync, status/result/clarification/cancel APIs.                                                              | Submit -> progress -> clarify -> decision -> sources works end to end.           |
| M10 Live Providers          | OpenAI, Anthropic, routing/fallback, contract tests.                                                                         | Live providers operate behind provider-independent boundary.                    |
| M11 Files                   | Private storage, presigned upload/download, document tools.                                                                  | User files participate in the same evidence system safely.                      |
| M12 Persistent Memory       | Promotion, scope, freshness, supersession, deletion, retrieval.                                                              | Continuity works without stale memory overriding current intent.                |
| M13 Advanced Robustness     | Counterfactuals, advanced sensitivity, decision versioning.                                                                  | Solandra explains conditions under which recommendation changes.                |
| M14 Evaluation + Production | Raw-model baseline, blind pairwise evals, security tests, restore tests, metrics/alerts.                                     | Quality, reliability, cost, and trust metrics are measurable.                   |

Externally testable MVP cut line: M1 through M10. M10 is the first
release candidate capable of demonstrating the product thesis with live
intelligence. M11-M13 may follow, but interfaces for
continuity/files/robustness are present earlier. Product requirements
M10 Continuity and M11 Recoverability remain mandatory product
requirements; the cut line distinguishes release sequencing, not whether
the requirements exist.

# 29. Evaluation Framework

- Component quality: intent, planning, research, validation, decision,
  response, memory.
- End-to-end decision quality: correctness, priority alignment, support,
  robustness.
- User outcome quality: whether the answer improves the user’s decision
  compared with direct AI interaction.
- Operational quality: success, latency, queue wait, retry, stalled-run
  rate, provider/tool health, cost.

## 29.1 Raw-model baseline

Every meaningful evaluation set compares Lattice with a direct response
from a strong configured model given the same user request and
reasonable context. The comparison records accuracy, priority alignment,
source quality, decision quality, time, and cost. Lattice complexity is
justified only when quality lift is material for the task class.

## 29.2 Provenance integrity

- Every final evidence-backed factual statement maps to a persisted
  claim.
- Every cited claim has at least one existing admitted source.
- Every claim-source relation is same-Run integrity checked.
- No rejected claim is presented as supported.
- Structural provenance integrity target: 100%.

## 29.3 Failure taxonomy

MISUNDERSTOOD_INTENT  
MISSED_CONSTRAINT  
BAD_PLAN  
MISSING_RESEARCH  
BAD_SOURCE  
CLAIM_EXTRACTION_ERROR  
MISSED_CONTRADICTION  
VALIDATION_ERROR  
BAD_SCORING  
PRIORITY_MISMATCH  
EXPLANATION_ERROR  
STALE_MEMORY  
PROVIDER_FAILURE  
TOOL_FAILURE  
DISPATCH_FAILURE  
CONCURRENCY_CONFLICT  
AUTHORIZATION_FAILURE

# 30. Launch Bars

| **Dimension**    | **Initial launch bar**                                                                                                                                  |
|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| Reliability      | >= 99% of accepted Runs reach a terminal state without manual intervention, excluding upstream outages beyond configured retry limits.                  |
| Provenance       | 100% structural integrity for final evidence-backed claims.                                                                                             |
| Constraints      | 0 benchmark cases select a candidate violating a validated hard constraint.                                                                             |
| Concurrency      | 0 duplicate logical decisions/evidence in crash/duplicate-delivery acceptance suite.                                                                    |
| Decision quality | Material improvement over raw-model baseline on complex decision tasks; initial blind pairwise target >= 60% Lattice wins with meaningful sample size.  |
| Planning         | Median initial task count remains bounded and unnecessary-task rate trends downward.                                                                    |
| Security         | 0 cross-user authorization violations in required resource matrix; SSRF regression suite passes.                                                        |
| Cost             | Median Run cost fits target unit economics once pricing is defined.                                                                                     |

# 31. Requirement Traceability

| **Requirement**                     | **Primary evidence of success**                                     |
|-------------------------------------|---------------------------------------------------------------------|
| M1 Natural-language intent          | Intent objective accuracy.                                          |
| M2 Intent and priority preservation | Objective/priority consistency across stages and explanation.       |
| M3 Progressive clarification        | Unnecessary and missed clarification rates.                         |
| M4 Expert-quality processing        | Quality lift over raw-model baseline.                               |
| M5 Reliability improvement          | Contradiction, unsupported-claim, and stale-source detection.       |
| M6 Verifiability                    | Structural provenance integrity and evidence inspection.            |
| M7 Decision ownership               | Structured-decision fidelity; explanation cannot change outcome.    |
| M8 Human communication              | Clarity, actionability, trade-off, and uncertainty evaluations.     |
| M9 Machinery abstraction            | UX review; no required internal orchestration choices.              |
| M10 Continuity                      | Relevant memory reuse and correction/deletion behavior.             |
| M11 Recoverability                  | Crash, restart, outbox, reconciliation, and retry acceptance tests. |
| M12 Measured improvement            | Blind pairwise and raw-model baseline evaluation.                   |

# 32. Definition of Contractor-Ready Completion

A milestone is DONE only when its defined acceptance evidence passes on
the current source/workspace state. “Works on the happy path” is not
completion for durability, provenance, authorization, or decision
ownership. Every discovered defect in an invariant-bearing path receives
a regression test before closure.

- No unresolved schema or API ambiguity exists for the milestone being
  accepted.
- Required migrations apply cleanly from an empty database and from the
  prior released schema version.
- Relevant unit, integration, security, and crash/concurrency acceptance
  tests pass.
- No known evidence conflict or unvalidated decision remains in
  acceptance artifacts.
- Artifacts and test evidence are reconstructible from the repository
  and declared environment.

# 33. Final Product Alignment Check

This architecture is successful only if it makes the product source true
in practice: a user can describe a goal normally; Lattice discovers what
matters without unnecessary friction; expert research and validation
happen internally; Solandra returns a trustworthy, understandable,
verifiable decision; and the user is not required to operate the
machinery. Internal complexity that does not improve those outcomes is a
candidate for removal.
