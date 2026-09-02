# 9. Task Ownership, Idempotency, and Dependencies

## 9.1 Logical task identity

Each executable task has a stable logical fingerprint derived from Run
ID, active plan version, task type, normalized task inputs, and
evidence/context version identifiers that materially affect the result.
Provider model choice is not part of identity unless provider choice
changes semantics rather than execution strategy.

- UNIQUE(run_id, task_fingerprint) is required for active logical tasks.

- A task attempt is separate from the logical task. Attempts may retry;
  only one accepted logical result may be committed.

- Provider completion followed by worker crash must not cause duplicate
  accepted evidence on retry.

## 9.2 Result commit

BEGIN  
lock logical task row  
reject commit if Run is terminal/cancelled or task epoch is stale  
if accepted_result_id already exists: return existing result  
persist result + admitted evidence atomically  
set accepted_result_id  
append task/run event as required  
create outbox wake-up for orchestrator  
COMMIT

## 9.3 DAG integrity

- Self-dependencies are forbidden.

- A plan must pass full directed-cycle validation before activation.

- No executable task is created from a plan that fails DAG validation.

- A superseded plan cannot create new tasks. Already-running tasks from
  a superseded plan may finish, but their results are admitted only if
  still compatible with the active Run epoch and evidence need.

# 10. Budget, Deadline, and Cancellation Semantics

## 10.1 Budget reservation

Budget checks are reservation-based so concurrent workers cannot each
spend the same remaining budget. Before dispatching a cost-bearing task,
the orchestrator atomically reserves an upper-bound cost envelope.
Completion converts reservation to committed usage; cancellation or
failed admission releases unused reservation.

available_budget = budget_cents - committed_cents - reserved_cents  
schedule only when estimated_upper_bound_cents <= available_budget

## 10.2 Deadlines

- No new cost-bearing work begins after deadline_at.

- Workers check deadline immediately before external calls and before
  committing results.

- A result completed after the deadline may be admitted only if the
  external work began before the deadline and the orchestrator policy
  explicitly permits late completion; otherwise it is recorded as
  diagnostic usage but not decision evidence.

## 10.3 Cancellation

- Cancellation is a durable terminal transition guarded by Run version.

- Workers check Run terminal/cancellation state before expensive
  external work and again before result commit.

- Late worker completions after cancellation cannot mutate evidence used
  by the cancelled Run.

- Provider cancellation is best-effort and does not override database
  truth.

# 11. Core Data Model

| **Entity group**                                                       | **Purpose**                                                                                     |
|------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| users / user_identities                                                | Domain user and external authentication identity mapping.                                       |
| conversations / messages                                               | User-facing interaction history.                                                                |
| runs / run_events                                                      | Durable workflow instance and ordered user-relevant event stream.                               |
| run_intents / intent_constraints / decision_criteria / run_assumptions | Explicit objective, priorities, constraints, and assumptions.                                   |
| run_clarifications                                                     | Versioned clarification questions and bound user responses.                                     |
| run_plans / planned_tasks / planned_task_dependencies                  | Auditable intended work and DAG.                                                                |
| run_tasks / run_task_attempts / run_task_dependencies                  | Actual durable work units and retry attempts.                                                   |
| dispatch_outbox                                                        | Transactional asynchronous dispatch intent.                                                     |
| sources / source_artifacts                                             | External provenance and immutable snapshots when evidence-backed claims depend on content.      |
| claims / claim_evidence / claim_validations                            | Atomic propositions, support/contradiction, qualification, and validation.                      |
| run_candidates / run_decisions / candidate_scores / criterion_scores   | Candidate evaluation and authoritative structured decisions.                                    |
| decision_sensitivity_tests                                             | Recorded robustness checks for recommendations.                                                 |
| user_memories / run_memory_usage                                       | Cross-Run context with provenance, scope, confidence, freshness, supersession, and usage audit. |
| intelligence_invocations / run_usage                                   | Provider/model audit, latency, token, reservation, and cost accounting.                         |
| user_files                                                             | Private uploaded files and object-storage ownership metadata.                                   |
| api_idempotency_keys                                                   | Idempotent public mutation contract.                                                            |

## 11.1 Database integrity requirements

- Closed-domain values use PostgreSQL enum types or CHECK constraints;
  unconstrained status/stance/type text is not permitted for
  invariant-bearing fields.

- Normalized numeric confidence/materiality/relevance fields include
  CHECK(value >= 0 AND value <= 1).

- Evidence relations include run_id in their key or equivalent composite
  foreign keys so a claim from Run A cannot reference a source from Run
  B.

- Final evidence-backed claims require at least one admitted
  non-rejected support relation.

- Immutable source snapshots carry content hashes and storage references
  whenever decision evidence depends on fetched mutable content.

# 12. Migration Sequence

Migrations are append-only and ordered. Names below define the initial
schema contract; exact DDL may evolve during implementation provided the
resulting schema preserves all invariants in this specification.

001_users  
002_auth_identities  
003_conversations  
004_messages  
005_runs  
006_run_events  
007_run_intents  
008_intent_constraints  
009_decision_criteria  
010_run_assumptions  
011_run_clarifications  
012_run_plans  
013_planned_tasks  
014_planned_task_dependencies  
015_run_tasks  
016_run_task_attempts  
017_run_task_dependencies  
018_dispatch_outbox  
019_sources  
020_source_artifacts  
021_claims  
022_claim_evidence  
023_claim_validations  
024_run_candidates  
025_run_decisions  
026_candidate_scores  
027_criterion_scores  
028_criterion_score_evidence  
029_decision_sensitivity_tests  
030_user_memories  
031_run_memory_usage  
032_user_files  
033_intelligence_invocations  
034_run_usage  
035_api_idempotency_keys

# 13. Intelligence Boundary

Solandra is not an LLM. It is Lattice-controlled decision behavior that
may use models as reasoning engines. All model access passes through
IntelligenceGateway and every internal model output required for product
state is schema-validated before admission.

interface IntelligenceGateway {  
generate<T>(request: IntelligenceRequest<T>):
Promise<IntelligenceResult<T>>;  
}  
  
type ModelRole =  
| "intent.interpret"  
| "plan.create"  
| "research.reason"  
| "validation.check"  
| "decision.assess"  
| "response.explain"  
| "memory.extract";

- Primary provider is OpenAI; Anthropic is a secondary/fallback
  provider. Actual model IDs are configuration.

- Adapters normalize authentication, streaming, structured output,
  usage, timeout/rate-limit errors, and provider-specific tool formats.

- Fallback is allowed only when the role contract can be preserved and
  the invocation remains attributable.

- Provider self-reported confidence is not treated as calibrated system
  confidence.

- Fixture mode must support end-to-end architecture testing without
  external credentials or cost.

# 14. Tool Boundary

- Models may request tools; they do not execute privileged tools
  directly.

- ToolGateway validates schema, authorization context, budget, deadline,
  and tool permissions.

- Initial tools: research.search_web, research.fetch_url,
  research.search_documents, research.read_document, analysis.calculate.

- Tool results are untrusted data until normalized and admitted as
  sources/claims.

- No tool may create new specialists or executable Run tasks.

# 15. Evidence Acquisition and Validation

Evidence is modeled as a first-class decision input rather than prose
attached to a model response.

External information  
-> Source  
-> Immutable Source Artifact / snapshot when required  
-> Claim  
-> Support / Contradiction relation  
-> Validation  
-> Decision Evidence

- Claim types: FACT, DERIVED, ASSESSMENT.

- Validation states: SUPPORTED, CONTESTED, INSUFFICIENT, REJECTED.

- Source quality considers authority, directness, recency, independence,
  completeness, and integrity of the captured artifact.

- Source count is not a truth metric; independence and directness
  matter.

- Rejected claims cannot be surfaced as supported facts.

- Material contested or insufficient claims must either trigger bounded
  follow-up work or remain explicit uncertainty in the decision.

## 15.1 Research stopping rule

Research continuation uses a normalized expected-information-value
calculation. This is normative in shape but configuration controls
thresholds; all factors are dimensionless values in [0,1], while
normalized_cost is estimated cost divided by the Run research budget
envelope.

expected_information_value =  
materiality  
* uncertainty  
* probability_new_research_resolves_gap  
  
continue_research when:  
expected_information_value - normalized_cost >=
research_value_threshold  
AND iteration_count < max_investigation_iterations  
AND budget/deadline allow additional work

# 16. Planning and Specialist Orchestration

- Decompose by decision requirement and unknown, not by persona.

- Select the cheapest sufficient capability first; specialize only when
  specialization materially improves discovery, interpretation, or
  correctness.

- Plans are persisted separately from execution tasks so replanning is
  auditable.

- Maximum active plan per Run: 1.

- Default maximum planned tasks per active plan: 20.

- Default maximum investigation iterations: 5.

- Specialist-to-specialist messaging, specialist-created specialists,
  and recursive spawning are not allowed in the MVP.

- Prefer breadth before depth: cheap screening, hard-constraint
  elimination, then deeper research on viable options.
