**SPEC-1-Lattice**

**Contractor-Ready MVP Architecture Specification**

*Ground-Up Reconstruction from the Lattice Product Concept Document*

| **Field**               | **Value**                                                                                                                                                 |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Authority status        | Candidate specification; requires Project Owner promotion before becoming an installed Project Source.                                                    |
| Product source of truth | Lattice — Product Concept Document (Product Vision and Concept Definition).                                                                               |
| Architecture derivation | Engineering decisions in this document are derived to satisfy the product source. They are not claims that the source itself selected these technologies. |
| Target                  | First externally testable Lattice MVP and contractor implementation baseline.                                                                             |
| Normative language      | MUST / MUST NOT are mandatory; SHOULD / SHOULD NOT require explicit justification to deviate; MAY is optional.                                            |

# 1. Source Basis and Interpretation

This specification is rebuilt from the ground up using the Lattice
Product Concept Document as the sole product-intent authority. The
concept defines the desired user outcome: ordinary-language access to
trustworthy, research-backed, understandable expert-quality knowledge
through one coherent Solandra/Lattice experience. It deliberately does
not prescribe software architecture. This document therefore separates
product truths from engineering choices.

## 1.1 Product truths preserved without reinterpretation

- A user begins with a normal-language goal and should not need to
  operate AI machinery.

- Lattice must understand what matters to the user and avoid unnecessary
  questioning.

- The system must perform appropriate research, expert reasoning,
  challenge unreliable information, and reconcile uncertainty.

- Solandra is the coherent user-facing decision and explanation layer;
  underlying AI providers are not the effective product interface.

- Human understanding, verifiability, continuity, and recoverability are
  product quality attributes, not implementation details.

- Additional internal complexity is justified only when it measurably
  improves user outcomes over raw AI interaction.

## 1.2 Architecture decision rule

When the product source is silent, this specification selects the
smallest architecture that can satisfy the product requirement while
preserving durability, traceability, security, provider independence,
and measurable quality. No internal mechanism is considered product
value merely because it is sophisticated.

# 2. Product Requirements

| **ID** | **Requirement**                  | **Definition**                                                                                                                                                                                       |
|--------|----------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| M1     | Natural-language intent          | Users can state the outcome they want in ordinary language.                                                                                                                                          |
| M2     | Intent and priority preservation | The objective, explicit priorities, constraints, and material clarifications remain bound to the Run through research, validation, decision, and explanation.                                        |
| M3     | Progressive clarification        | The system asks only questions whose answers can materially change the work or decision.                                                                                                             |
| M4     | Expert-quality processing        | Lattice performs or coordinates the research, comparison, specialist reasoning, and synthesis that the user should not have to reproduce.                                                            |
| M5     | Reliability improvement          | Material information is challenged for incompleteness, conflict, staleness, unsupported claims, and poor source quality before being treated as decision evidence.                                   |
| M6     | Verifiability                    | Material factual claims used in a decision retain source lineage and validation state.                                                                                                               |
| M7     | Decision ownership               | Solandra/Lattice owns the structured decision. Models, workers, tools, and specialists may contribute evidence or assessments but cannot independently select the authoritative user-facing outcome. |
| M8     | Human communication              | The response explains the conclusion, trade-offs, uncertainty, and supporting evidence at a useful level for the user.                                                                               |
| M9     | Machinery abstraction            | Users are not normally required to select providers, agents, workflows, queues, research strategies, or validation mechanisms.                                                                       |
| M10    | Continuity                       | Useful stable context can survive across interactions when relevant.                                                                                                                                 |
| M11    | Recoverability                   | Durable work and important knowledge are not lost solely because a process, conversation, or provider call fails.                                                                                    |
| M12    | Measured improvement             | Expert treatment must be evaluated against a strong raw-model baseline; complexity that fails to improve outcomes must be removable.                                                                 |

## 2.1 Should requirements

- S1 - Help users discover relevant decision dimensions when they do not
  know which criteria matter.

- S2 - Concentrate depth where it materially improves correctness or
  decision readiness.

- S3 - Expose evidence, uncertainty, and machinery progressively rather
  than by default.

- S4 - Support multiple domains without reducing expert behavior to
  generic personas.

- S5 - Preserve the ability to recalculate a decision when priorities
  change without repeating unchanged research.

## 2.2 Initial non-goals

- User-authored agent graphs or manual agent orchestration.

- Provider-specific product semantics.

- Recursive autonomous agent spawning.

- A visible internal “expert persona” system whose labels substitute for
  evidence or quality.

- Multi-region active-active infrastructure, Kubernetes, or a
  development-factory control plane for the MVP.

# 3. Architecture Overview

Lattice is implemented as a durable decision system around bounded
intelligence calls. PostgreSQL is the authoritative state store. A
central application-owned state machine controls a Run. Workers perform
bounded tasks and return evidence or structured analysis. Solandra
persists an authoritative structured decision before any
natural-language explanation is generated.

User  
-> Public API  
-> Intent / Clarification  
-> Durable Run Orchestrator  
-> Research / Analysis Tasks  
-> Evidence + Claims  
-> Validation  
-> Structured Decision (Solandra)  
-> Explanation View  
-> User

## 3.1 Architectural invariants

- PostgreSQL is authoritative for Runs, intents, plans, tasks, evidence
  metadata, validations, decisions, memory, usage, and dispatch state.

- The queue transports wake-ups and work references; it does not define
  product state.

- Only the orchestrator may advance overall Run status or create
  executable Run tasks.

- Workers may update only the task execution/result they own and append
  admitted evidence through constrained repositories.

- State is durably committed before dependent work can become
  dispatchable.

- Every logical dispatch and logical task result is idempotent.

- Every evidence-backed final factual claim resolves to admitted source
  lineage for the same Run.

- The structured decision is authoritative; the explanation may not
  alter it.

- Provider-hosted conversation or agent state is never authoritative.

- External content is untrusted data and cannot become privileged
  instructions.

# 4. Technology Baseline

| **Concern**           | **MVP decision**                                                              | **Rationale**                                                                                   |
|-----------------------|-------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Backend               | TypeScript on Node.js 24 LTS                                                  | Strong ecosystem for API, provider SDKs, queues, and shared typed contracts.                    |
| System of record      | PostgreSQL 18                                                                 | Durable transactions, relational integrity, JSONB, advisory/row locking, and queue co-location. |
| Durable work          | Application state machine + PostgreSQL transactional outbox + pg-boss 12.27.x | Separates product semantics from transport while closing the DB-commit/dispatch gap.            |
| Public API            | Fastify 5.x; JSON REST + SSE                                                  | Small surface, strong TypeScript support, streaming progress.                                   |
| AI abstraction        | AI SDK 7.x behind Lattice-owned interfaces                                    | Provider-independent integration without surrendering orchestration semantics.                  |
| Primary / fallback AI | OpenAI / Anthropic                                                            | Two-provider boundary for resilience and evaluation; exact models are configuration.            |
| Authentication        | Better Auth behind AuthService                                                | Replaceable authentication boundary.                                                            |
| Object storage        | Private S3-compatible storage via presigned URLs                              | Large artifacts outside PostgreSQL while retaining database ownership metadata.                 |
| Deployment            | Managed container platform                                                    | Supports separate API, orchestrator, worker processes without Kubernetes requirement.           |

# 5. Repository Structure and Dependency Direction

lattice/  
├── apps/  
│ ├── api/  
│ ├── orchestrator/  
│ └── worker/  
├── packages/  
│ ├── domain/  
│ ├── database/  
│ ├── intelligence/  
│ ├── tools/  
│ ├── specialists/  
│ ├── queue/  
│ ├── storage/  
│ ├── auth/  
│ ├── observability/  
│ └── contracts/  
├── migrations/  
├── infrastructure/  
│ ├── docker/  
│ └── deployment/  
├── tests/  
│ ├── unit/  
│ ├── integration/  
│ ├── fixtures/  
│ └── evals/  
├── package.json  
├── tsconfig.base.json  
└── README.md

- apps contain deployable composition roots; packages contain reusable
  capabilities.

- packages/domain MUST NOT import Fastify, pg-boss, provider SDKs, S3
  SDKs, or a PostgreSQL driver.

- Infrastructure implementations may depend on domain contracts; domain
  logic must not depend on infrastructure implementations.

- Provider, queue, storage, and authentication libraries remain
  replaceable behind Lattice-owned interfaces.

- Cross-package dependency cycles are prohibited and checked in CI.

# 6. Core Request Lifecycle

1. Understand: create a durable Run, preserve the initiating user
   message, interpret the objective, priorities, constraints, and
   relevant context.

2. Clarify: if a missing answer has material expected decision value,
   persist a clarification request and wait for the user.

3. Plan: persist a bounded plan consisting of decision requirements,
   unknowns, capabilities, planned tasks, and dependencies.

4. Investigate: create and execute bounded tasks for research,
   retrieval, calculation, or specialist analysis.

5. Validate: validate source quality, claim support, contradiction,
   evidence coverage, and material unresolved gaps.

6. Decide: apply hard constraints, weighted criteria, evidence
   coverage, uncertainty, and sensitivity checks to produce a persisted
   StructuredDecision.

7. Explain: generate a user-facing explanation from the persisted
   decision and admitted evidence, then mark the Run complete.

# 7. Durable Run State Machine

CREATED  
-> UNDERSTANDING  
-> AWAITING_CLARIFICATION -> UNDERSTANDING  
-> PLANNING  
-> INVESTIGATING  
-> VALIDATING  
-> INVESTIGATING (material gap worth resolving)  
-> DECIDING  
-> COMPLETED  
Any non-terminal state -> CANCELLED  
Any active state except AWAITING_CLARIFICATION -> FAILED  
COMPLETED, CANCELLED, FAILED are terminal.

FAILED is a terminal Run instance, not a loss of recoverability. A
user-initiated retry or system recovery creates a new Run that records
provenance to the failed Run or resumes from explicitly reusable
admitted artifacts. The original failed Run is never silently rewritten
into success.

## 7.1 Canonical transition contract

UPDATE runs  
SET status = :next_status,  
version = version + 1,  
updated_at = now()  
WHERE id = :run_id  
AND status = :expected_status  
AND version = :expected_version;

- Exactly one row updated means the transition owns the epoch. Zero rows
  means the wake-up is stale or concurrent and must stop without side
  effects.

- Run event append, downstream logical task creation, budget reservation
  changes, and outbox entries caused by a transition occur in the same
  database transaction.

- The orchestrator MUST derive work only after acquiring the current Run
  epoch through this contract or an equivalent row-locking transaction
  with identical semantics.

# 8. Transactional Dispatch and Reconciliation

The implementation MUST not rely on “commit, then enqueue” as a
correctness boundary. Every intended asynchronous dispatch is first
persisted in a transactional outbox within the same transaction that
makes the work eligible.

BEGIN  
acquire current Run epoch  
verify expected state / budget / deadline / cancellation  
persist stage outputs  
create or activate logical tasks  
append run_events  
INSERT INTO dispatch_outbox(logical_key, queue_name, payload,
available_at, ...)  
advance Run version/status where applicable  
COMMIT  
  
Dispatcher:  
claim unsent outbox rows  
enqueue queue wake-up with logical_key  
mark dispatched_at  
  
Reconciler:  
rediscover unsent outbox rows and stalled active Runs  
re-emit wake-ups safely

- dispatch_outbox.logical_key is unique.

- A queue wake-up can be delivered more than once without producing
  duplicate logical work.

- Reconciliation is defense-in-depth, not the only mechanism closing a
  commit/dispatch atomicity gap.
