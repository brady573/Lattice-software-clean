# 17. Solandra Structured Decision

## 17.1 Decision ordering

8. Apply validated hard constraints. A violating candidate is
   ineligible regardless of weighted score.

9. Normalize remaining criterion weights so their sum is 1.0. Explicit
   user priorities outrank inferred priorities.

10. Normalize measurable criterion values onto documented [0,1]
    scoring functions with declared directionality.

11. Use model assessment only for genuinely qualitative criteria and
    persist the assessment evidence and rubric.

12. Track criterion score and evidence coverage separately.

13. Apply a bounded uncertainty penalty to low-coverage criteria rather
    than treating unknown as zero.

14. Compute candidate ranking, winner separation, and sensitivity to
    reasonable changes in weights/uncertain scores.

15. Persist StructuredDecision before explanation generation.

## 17.2 Default score semantics

normalized_weight_i = raw_weight_i / sum(raw_weights)  
  
adjusted_criterion_score_i =  
observed_score_i * (0.75 + 0.25 * evidence_coverage_i)  
  
candidate_score = Σ(adjusted_criterion_score_i * normalized_weight_i)  
  
base_confidence = geometric_mean(  
evidence_coverage,  
evidence_quality,  
winner_separation,  
stability  
)  
  
confidence_band:  
HIGH >= 0.80  
MEDIUM >= 0.55 and < 0.80  
LOW < 0.55

The exact default penalty constants and confidence thresholds are
configuration subject to evaluation, but changes require benchmark
evidence because they affect decision semantics. A zero factor does not
automatically collapse all confidence unless the configured policy
explicitly defines that condition as fatal.

## 17.3 Decision outcomes

- RECOMMEND
- CONDITIONAL
- NO_CLEAR_WINNER
- NO_SUITABLE_OPTION
- INSUFFICIENT_INFORMATION

## 17.4 Sensitivity scope

Basic sensitivity is part of the MVP decision invariant: perturb
explicit/inferred criterion weights within configured reasonable bounds
and detect whether the winner changes. Advanced counterfactual
explanation and multi-dimensional robustness analysis are post-MVP
enhancements.

# 18. Explanation Fidelity

- The explanation generator receives the persisted StructuredDecision
  and admitted evidence as read-only inputs.

- It may change wording, ordering, and detail level but may not change
  selected outcome, ranking, constraint status, confidence band, or
  evidence state.

- A fidelity validator compares the generated response view model to
  StructuredDecision before completion.

- If the explanation contradicts the structured decision, the Run cannot
  be marked COMPLETED until regenerated or failed with attributable
  evidence.

# 19. User Memory and Continuity

Continuity is a product requirement, but persistent memory is not
required for the first vertical-slice proof. Interfaces and schema
boundaries exist from the start so later memory does not become an
uncontrolled provider feature.

- Memory types: PREFERENCE, CONSTRAINT, GOAL, PROFILE_FACT, DECISION,
  DOMAIN_CONTEXT.

- Scopes: GLOBAL, DOMAIN, PROJECT.

- Current explicit instruction outranks all memory.

- Explicit memories outrank inferred memories.

- Inferred memories remain tagged and require higher promotion
  thresholds.

- Memories carry source, confidence, scope, freshness, supersession
  history, and usage audit.

- Memory is context about the user/project, not evidence about the
  external world.

Memory precedence:  
1. Current explicit user instruction  
2. Current Run clarification  
3. Recent explicit persistent memory  
4. Older explicit persistent memory  
5. Inferred persistent memory  
6. System inference

# 20. Public API and Realtime Contract

POST /api/v1/conversations/:conversationId/messages  
GET /api/v1/runs/:runId  
GET /api/v1/runs/:runId/events  
POST /api/v1/runs/:runId/clarification  
POST /api/v1/runs/:runId/cancel  
GET /api/v1/runs/:runId/result  
GET /api/v1/runs/:runId/sources  
POST /api/v1/files/upload  
POST /api/v1/files/:fileId/complete

- Mutations that continue asynchronously return 202 Accepted with
  durable Run identity.

- All user-owned resources are scoped to authenticated user_id at the
  repository query boundary, not only at the route layer.

- Run events use a per-Run monotonically increasing event sequence
  persisted transactionally with state changes.

- SSE Last-Event-ID resumes at sequence N+1. If the requested cursor is
  older than retained events, the API returns a typed resync requirement
  rather than silently skipping history.

- Public progress exposes user-relevant stages and clarifications, not
  hidden chain-of-thought or raw internal model logs.

## 20.1 API idempotency

- Idempotency keys are scoped to authenticated user + HTTP method +
  canonical route.

- The request body is hashed. Reuse of the same key with a different
  body returns 409 Conflict.

- Concurrent identical submissions converge on one durable response
  record.

- Default retention: 24 hours for mutation idempotency records unless
  product needs require longer.

# 21. Security Boundary

## 21.1 Authentication and authorization

- Only lattice-api is public; orchestrator and workers are private
  services.

- Every read and mutation repository method for user-owned resources
  includes user_id or an equivalent authenticated ownership predicate.

- Authorization tests cover Runs, conversations, events, results,
  sources, files, clarification, cancellation, and signed object access.

## 21.2 SSRF-safe URL fetching

- Allow only http/https schemes.

- Reject credentials in URLs and disallowed ports by policy.

- Resolve and validate all A/AAAA addresses before connection; reject
  loopback, link-local, private, carrier-grade NAT, multicast, reserved,
  and metadata service ranges.

- Pin validated resolution for the connection or revalidate to mitigate
  DNS rebinding.

- Revalidate every redirect target; enforce maximum redirect count.

- Enforce connect/read timeouts, response-size limits, decompression
  limits, and allowed content types.

## 21.3 File upload security

- Buckets are private; object keys are server-generated and user-scoped.

- Presigned upload URLs are short-lived and constrained by expected key,
  size, and content metadata where the storage provider allows.

- Completion verifies object existence, expected ownership metadata,
  maximum size, and checksum when available.

- Incomplete uploads expire and are garbage-collected.

- Document processing treats all file content as untrusted data.

## 21.4 Data minimization and logs

- Only task-required user context is sent to AI providers.

- Full prompts, full user documents, provider outputs, access tokens,
  and credentials are not logged by default.

- Structured invocation metadata, hashes, timing, cost, role, and
  failure class are logged for observability.

# 22. Deployment Shape

Managed Container Platform  
Public:  
lattice-api (2+ replicas for production)  
Private:  
lattice-orchestrator (1+ replicas)  
lattice-worker (1+ replicas)  
  
Managed PostgreSQL 18  
Private S3-compatible object storage  
OpenAI / Anthropic  
Research providers

Multiple orchestrator replicas are safe because Run transitions are
epoch/CAS guarded and downstream logical work is uniqueness constrained.
No distributed leader election is required for correctness in the MVP.

# 23. Configuration and Startup Readiness

- Configuration is schema-validated at startup and failures are fatal
  before serving traffic.

- LATTICE_PROVIDER_MODE=fixture runs the complete architecture without
  live AI cost.

- API readiness requires database connectivity and expected schema
  version.

- Orchestrator readiness additionally requires queue/outbox dispatcher
  initialization.

- Worker readiness additionally requires required provider/tool
  dependencies for the configured mode.

# 24. First End-to-End Vertical Slice

The first implementation slice proves the entire durable lifecycle
before broad feature depth. It uses a constrained demo question
comparing two named products by price and one measurable criterion, with
deterministic research/provider fixtures.

User message  
-> Run CREATED  
-> UNDERSTANDING  
-> PLANNING  
-> 1-2 research tasks  
-> source persistence  
-> claim extraction  
-> validation  
-> hard-constraint / simple weighted scoring  
-> basic sensitivity  
-> StructuredDecision persisted  
-> faithful explanation  
-> COMPLETED

- Implement message submission, GET Run, GET Run events, and GET Run
  result in this slice.

- Exclude persistent memory, live web research, live provider failover,
  file uploads, and advanced counterfactual analysis from this slice.

- Do not exclude the interfaces or schema boundaries required for those
  later capabilities.
