**LATTICE**

**Living Software Design**

Path from the current V36 prototype to the 1.0 release

**Canonical Living Design 0.5 | August 26, 2026**

Repository baseline: brady573/Lattice-Software @ cad448809a8f02df6d31de4e516cd1df21d5b456

Repository authority: Owner-approved on August 26, 2026 as the canonical living Product design source for Lattice direction and 1.0 sequencing. Item-level status remains controlling: Confirmed items are authoritative; Working assumptions remain reversible; Proposed and Open decision items remain non-authoritative until separately accepted.

**Document purpose**

Define a coherent, implementation-oriented path from the current offline truth-centered prototype to a production-capable Lattice 1.0 while preserving the protected V36 epistemic contract. This is a living design: confirmed requirements and decisions are separated from working assumptions and open decisions, and future revisions should record why the design changed.

**Design authority**

This document is the canonical living Product design source for architecture direction and roadmap sequencing. Explicit Owner decisions and protected V36 contracts remain controlling. Within this document, item-level status is authoritative: Confirmed items govern; Working assumptions may guide reversible work; Proposed and Open decision items do not authorize Product mutation until separately accepted. Where older roadmap or SPEC-1 sequencing conflicts with this document, this document controls forward sequencing; detailed confirmed SPEC-1 and V36 contracts remain normative unless explicitly superseded.

# 0. Document Control and Living-Design Rules

| Field | Value |
|---|---|
| Document status | Owner-approved canonical living Product design baseline; not a blanket approval of Proposed or Open decision items. |
| Version | 0.5 |
| Repository baseline | main @ cad448809a8f02df6d31de4e516cd1df21d5b456 |
| Current implementation mode | Deterministic offline V36 prototype with durable/async components, an explicit Solandra presentation boundary, a Product-owned provider-neutral Lattice Model Gateway boundary, a development-only transient simulated-conversation surface, an Owner-designated external V7 LLM Simulation Lab, an Owner-approved Solandra offline-prototype UI design package, and an Owner-approved canonical system naming convention. |
| Target | First production-capable 1.0 release of the core Lattice decision/research experience. |
| Primary authority | Explicit Owner decisions + this document's Confirmed items + qualified Product sources + protected V36 contract. |
| Design discipline | Confirmed requirements, proposals, assumptions, open decisions, risks, and rejected options remain explicitly distinct. |

## 0.1 How this document changes

- Every material revision updates the document version, repository baseline SHA, change log, and affected decision records.
- Implementation does not silently become architecture. If code and this design diverge, the divergence is investigated and resolved explicitly.
- A working assumption may guide implementation only while it remains visible and reversible; Owner correction supersedes it.
- Truth-core semantic changes require an explicit qualified Truth-Core Work Item. Outer feature work may not weaken V36 indirectly.
- Release-gate PASS requires observed behavior or reproducible evidence on the exact candidate revision; prose intent alone is not validation.

## 0.2 Claim-status vocabulary

| Status | Meaning |
|---|---|
| Confirmed | Established by current repository/Product sources or an explicit Owner decision. |
| Working assumption | Used to make the design coherent, but not yet confirmed by the Owner. |
| Proposed | Recommended architecture or Product behavior awaiting acceptance. |
| Open decision | A decision that materially affects design and must be resolved before the dependent milestone can complete. |
| Deferred | Intentionally outside the 1.0 critical path unless circumstances change. |

## 0.3 Current working assumption about what “1.0” means

**Working assumption — 1.0 release definition:** Lattice 1.0 is the first production-capable release in which a user can describe a meaningful decision in natural language, be asked only decision-critical clarifying questions, have bounded live research evaluated through V36, receive a persisted StructuredDecision and faithful Solandra explanation with material uncertainty/evidence, and rely on durable execution, cancellation, multi-user isolation, observability, and recoverability. The release does not require autonomous external actions, a visible multi-agent UI, or every possible domain/file workflow.

This assumption is intentionally explicit because the current repository does not contain an Owner-approved complete 1.0 feature list. The remainder of this document is designed so the scope can be narrowed or expanded without invalidating the authority boundaries.

## 0.4 Canonical Lattice system registry and naming

**Confirmed Owner decision:** use one canonical name for each major Product or prototype system so architecture, handoffs, tests, and status reports do not collapse distinct authority boundaries. The detailed registry is maintained in `docs/design/Lattice-System-Registry-and-Naming.md`.

| Class | Canonical name | Short form | Owns |
|---|---|---|---|
| Umbrella Product | **Lattice Product** | **Lattice** | The complete user-facing Product and Product-owned architecture. |
| Product authority | **Lattice Intent Authority** | **Intent Authority** | Versioned structured user intent, intent deltas, clarification state, USER provenance, correction lineage, and exact `intentVersionId` binding. |
| Product runtime | **Lattice Execution Runtime** | **Execution Runtime** | Durable Run lifecycle, coordination, cancellation, recovery, public Run events, and research scheduling/execution. |
| Product boundary | **Lattice Model Gateway** | **Model Gateway** | Provider-neutral model requests, capability negotiation, bounded/cancellable invocation, and model-adapter isolation. |
| Product authority | **V36 Truth Core** | **V36** | External factual truth, evidence qualification/admission, provenance, contradiction, proof status, temporal applicability, and truth confidence. |
| Product authority | **Lattice Decision Engine** | **Decision Engine** | Hard-constraint evaluation, eligibility, preference utility/ranking, trade-offs, tie/outcome semantics, and authoritative `StructuredDecision`. |
| Product experience | **Solandra Experience** | **Solandra** | Conversation UX, clarification/progress presentation, explanation, semantic projection, Knowledge Crystallization, evidence/uncertainty presentation, and continuation. |
| External development system | **V7 LLM Simulation Lab** | **V7 Simulation Lab** | Offline model/API simulation and qualification evidence about the simulator itself. |

Canonical conceptual flow:

```text
User conversation
      |
      v
Lattice Intent Authority
      | confirmed IntentVersion
      v
Lattice Execution Runtime
      | research / operational work
      v
V36 Truth Core
      | admitted decision evidence
      v
Lattice Decision Engine
      | StructuredDecision
      v
Solandra Experience
      |
      v
User
```

The Lattice Model Gateway is a non-authoritative capability boundary that may be invoked by Product systems where a qualified design permits model assistance. Model output remains proposal/rendering material until the owning Product authority accepts it under its own contract. During prototype development, the V7 LLM Simulation Lab may stand in for model/API behavior at that boundary; the lab never acquires Lattice Product authority merely through that use.

Use suffixes consistently: **Core** for protected semantic authority, **Authority** for canonical Product state in a bounded semantic domain, **Engine** for deterministic authoritative evaluation, **Runtime** for operational lifecycle/execution, **Gateway** for non-authoritative capability boundaries, **Experience** for human-facing presentation/interaction, and **Lab** for external development experimentation. `Specification`, `Handoff`, `Design`, and `Package` name artifacts, not runtime systems.

Avoid unqualified terms such as `conversation system`, `AI system`, `model system`, `truth layer`, `decision system`, `Solandra system`, or bare `V7` when they could be mistaken for another authority boundary.

# 1. Executive Design Position

Lattice should reach 1.0 by building outward around the protected V36 Truth Core rather than replacing the current architecture with a new distributed system. The current repository already has the right authority direction: untrusted input/research -> V36 authoritative truth -> StructuredDecision -> faithful presentation. The primary 1.0 work is to make the surrounding Product, orchestration, provider, security, and operational layers production-capable.

## 1.1 Recommended architectural shape

**Recommended approach:** Remain a modular monolith in one codebase through 1.0, but run it as separate process roles: API, Run coordinator worker, Research worker, and migration/admin process. Use PostgreSQL as the authoritative durable state store and keep the transactional outbox + lease model as the queueing backbone. Do not introduce microservices or a separate message broker until measured scale, isolation, or operational requirements justify them.

Why: this preserves the repository’s existing CAS, transactional outbox, restart-safety, truth snapshot, and PostgreSQL validation investments while avoiding a second distributed consistency problem before the Product semantics are mature.

What would change the recommendation: sustained throughput that materially overloads PostgreSQL queue/outbox behavior; independent scaling/failure isolation that cannot be achieved with process roles; provider workers requiring a different runtime; multi-region active-active requirements; or a need to deploy the truth core under a separately governed security boundary.

## 1.2 Most important design changes before 1.0

1. Wire the Lattice Execution Runtime async durable path as the default PostgreSQL runtime, including one migration authority and real worker processes.
2. Connect durable research tasks to V36 Truth Core through a provider-neutral research-request contract without moving proof/admission semantics into orchestration.
3. Add Lattice Intent Authority interpretation, material clarification, and planning so users no longer have to construct RunRequest manually.
4. Replace string-key/raw-number Lattice Decision Engine criteria with typed criterion definitions and explicit utility semantics.
5. Add a persistent conversation/message model, progress delivery, authentication, user isolation, and correction-aware user preference continuity.
6. Promote one or more live providers only after the offline baseline is fixed and exact live-provider acceptance proves V36 semantics remain intact.
7. Evolve Solandra Experience from exact canonical text to richer communication while preserving a read-only, evidence/decision-bound fidelity contract.
8. Add production observability, security/privacy controls, performance budgets, migration/rollback discipline, and release readiness gates.

# 2. Product Outcome and 1.0 Scope

## 2.1 1.0 user outcome

A user should be able to start with an ordinary-language goal rather than a schema. Lattice should determine which missing information materially changes the result, research only what is needed, distinguish trustworthy evidence from unresolved or conflicting claims, and return a usable recommendation or an explicit statement that the evidence does not support a definitive decision.

```text
User goal
  |
  v
Lattice Intent Authority
  |-- clear enough ------------------------------.
  |                                             |
  '-- material ambiguity -> clarification ->----'
  |
  v
DecisionPlan / Lattice Execution Runtime
  |
  v
Durable bounded research
  |
  v
V36 Truth Core
  |
  v
Lattice Decision Engine / StructuredDecision
  |
  v
Solandra Experience
```

## 2.2 Proposed 1.0 must-have scope

| Capability | 1.0 position | Design intent |
|---|---|---|
| Natural-language intake | Required | User supplies goals and context conversationally; structured intent is derived internally by the Lattice Intent Authority boundary. |
| Material clarification | Required | Ask only when unresolved information can materially change options, architecture of the Run, or result. |
| Priority / constraint modeling | Required | Explicit, versioned user intent drives decision logic; inferred material intent is confirmable/correctable. |
| Durable asynchronous Runs | Required | 202 acceptance, progress, cancellation, retry/recovery, and restart-safe completion through Lattice Execution Runtime. |
| Bounded live research | Required under working 1.0 assumption | Provider-neutral research with budgets/deadlines; provider output remains untrusted candidate evidence. |
| V36 truth adjudication | Required / protected | All material external-world facts that affect authoritative decisions cross V36 Truth Core. |
| Structured decision support | Required | Lattice Decision Engine handles hard constraints, typed preferences, tradeoffs, uncertainty, deterministic tie policy, and traceability. |
| Solandra explanation | Required | Solandra Experience consumes persisted truth/decision state as read-only authority. |
| Persistent conversations | Required | Messages, intent revisions, Runs, decisions, and correction history remain recoverable. |
| Progress delivery | Required | Polling plus server-sent progress stream or equivalent; progress does not expose internal secrets. |
| Authentication / tenant isolation | Required | Real subject identity replaces fixture-user and scopes all durable user data/idempotency. |
| Basic preference continuity | Required | User-authored goals/preferences may be reused; prior external facts are not automatically reusable truth. |
| Production observability | Required | Structured logs, metrics, health/readiness, correlation IDs, and actionable operational diagnostics. |

## 2.3 Proposed deferred scope

| Capability | Position | Reason |
|---|---|---|
| Autonomous external actions / transactions | Deferred | Decision support should be proven before irreversible action authority is introduced. |
| Visible agent/workflow selection | Deferred | Conflicts with the Product principle that internal machinery stays hidden unless materially relevant. |
| Microservice decomposition | Deferred | Adds distributed operational cost without a demonstrated 1.0 requirement. |
| Multi-region active-active | Deferred | Requires stronger replication/consistency contracts than the current Product needs establish. |
| General-purpose file ingestion | Open decision | Architecturally compatible, but may expand security/storage/parsing scope substantially. See OD-010. |
| Large plugin/tool ecosystem | Deferred | Provider/tool breadth should not precede quality and authority guarantees. |

# 3. Current Baseline at the Studied Revision

The following is the starting state for the 1.0 design. It is intentionally summarized here so this document can remain self-contained; deeper detail is in the repository-understanding baseline created from the same revision.

| Area | Current state | 1.0 implication |
|---|---|---|
| V36 Truth Core | Implemented offline with typed claims, proof contracts, provenance, adjudication, admission, snapshots, fidelity tests. | Preserve semantics; integrate live/durable research around it. |
| Lattice Execution Runtime / Run state | Run status/version CAS, durable truth/Run persistence, durable research orchestration components, async API control, and Run worker logic exist as components. | Compose the currently separated durable components into the default runtime/process roles. |
| Research | Offline fixture enrichment executes in-process; durable research task DAG/attempt/outbox mechanics also exist. | Connect durable provider execution to V36 without giving runtime/orchestration epistemic authority. |
| Lattice Model Gateway | Product-owned provider-neutral offline model boundary with deterministic fixture support, bounded/cancellable/idempotent runtime semantics, and loopback-only OpenAI-compatible qualification support. Current main also composes this boundary into a development-only transient simulated-conversation surface. | Reuse for intent/explanation/provider qualification while preserving the rule that model output is proposal/rendering material, not intent, truth, decision, or Product-validation authority. |
| V7 LLM Simulation Lab | Owner-designated external prototype-stage artifact: `lattice-llm-simulation-lab` `1.7.0-research`, polished standalone/offline module, not Lattice Product code. | Use as the prototype model/API simulation and qualification surface; its experiment outputs do not establish Lattice Product correctness or production readiness. |
| Solandra offline-prototype UI design | Owner-approved external offline-prototype Product design artifact: `lattice-solandra-ui-design-package-offline-prototype-approved`, status `owner-approved-offline-prototype-preimplementation`. | Use as a qualified Product-design input for the bounded offline-prototype UI Work Item; implementation/browser/accessibility/E2E acceptance remain unearned until executed. |
| Lattice Intent Authority | Canonical subsystem name and authority boundary are Owner-approved. Current durable/versioned structured intent authority is not implemented. An external conversation-drift handoff is available as a design candidate. | Resolve OD-004 and separately qualify/promote the detailed candidate architecture before implementing it as normative Product behavior. |
| Lattice Decision Engine | Current prototype decision logic exists with hard constraints and weighted preference scoring using current fixture assumptions. | Introduce typed criteria, utility functions, tri-state constraint state, explicit tie/outcome semantics. |
| Solandra Experience | Explicit deterministic presentation boundary exists. Current main also includes a development-only transient simulated-conversation testing surface. | Implement the approved offline-prototype UX without moving intent/truth/decision authority into Solandra; later generalize explanation under a qualified fidelity contract. |
| Auth / durable conversation persistence | Fixture/injectable subject; no 1.0 durable conversation/message authority path. | Required before multi-user 1.0. |
| Deployment | One web service + PostgreSQL blueprint; no final worker topology. | Introduce process-role deployment and readiness gates. |

## 3.1 Prototype-stage V7 LLM Simulation Lab

**Confirmed Owner placement:** the V7 LLM Simulation Lab belongs in the prototype stage. It is an external development artifact used to exercise and qualify provider-neutral/model-facing boundaries before live-provider promotion. It is not vendored into Lattice Product state by this design decision and is not a runtime or production dependency merely because it appears in the roadmap.

Bound artifact evidence supplied for this design revision:

- Package: `lattice-llm-simulation-lab` version `1.7.0-research`.
- Polished bundle SHA-256: `673aea1363458144cdab1961615ac640777f0c2cedb7ef10e3fd3ffc1f23df7e`.
- Deployable npm tarball SHA-256: `2233295ca35bc3e59d3f944a850d0ceb770b6009b8ba86e3b8dc6f5e40d3871f`.
- Polished source tests: 21/21 PASS; deployment smoke PASS; clean consumer import/CLI validation PASS.
- V6 executable regression gates on the polished package: 11/11 atomic PASS and 6/6 compound PASS.
- V7 executable micro-evolution: all 625 bounded micro-configurations executed before evolution; held-out baseline 11/18 (61.11%) and frozen champion 15/18 (83.33%).

Interpretation boundary: V7's micro-evolution capacities and held-out improvement are evidence about the declared standalone simulator experiment only. They are not Lattice Product capacity recommendations, V36 acceptance evidence, real-model reliability measurements, or production-readiness evidence. The package's own validation explicitly records `latticeProductValidation: false` and `productionReady: false`.

## 3.2 Owner-approved Solandra offline-prototype UI design package

**Confirmed Owner approval:** the refined Solandra UI design is approved as the normative Product-design target for the bounded offline prototype. Approval is design authority for that scope, not implementation validation or production authorization.

Bound artifact evidence supplied for this design revision:

- Archive: `lattice-solandra-ui-design-package-offline-prototype-approved.zip`.
- Archive SHA-256: `36a343029d2f455af1767b853bbd527710b63331efc805b02a672bbb2bbbfcd8`.
- Manifest package: `lattice-solandra-ui-design-package-offline-prototype-approved`.
- Manifest status: `owner-approved-offline-prototype-preimplementation`.
- Approval scope: `offline prototype UI only`.
- Package repository baseline: `73d707b5921e01b46458381dad633203d8d63af0`.
- Package repository tree: `9f98a7ecabe25af895baa0fd1d191eb7bbb40562`.
- Premium validation report status: `DESIGN PACKAGE PREMIUM-VALIDATED AND OWNER-APPROVED FOR OFFLINE PROTOTYPE — NOT IMPLEMENTATION VALIDATION`.
- Package refinement includes explicit scroll ownership, overlay/layer ownership, IME-safe composer semantics, active-Run local drafting without implicit queueing, new-update behavior, focus/touch requirements, degraded-transport handling, and an acceptance corpus.

Unclaimed validation remains explicit: implementation does not yet exist by virtue of approval; official designmd lint, strict repository audit, browser, keyboard, screen-reader, responsive, reduced-motion, visual-regression, and end-to-end Product acceptance require execution against the exact implementation revision.

Interpretation boundary: this Owner decision promotes the design requirements for the offline-prototype UI scope only. It does not change V36 Truth Core authority, Lattice Decision Engine authority, Lattice Intent Authority semantics, Solandra's read-only fidelity boundary, live-provider status, or production readiness.

## 3.3 Intent Authority Design Handoff Candidate

The uploaded external artifact `lattice-conversation-drift-design-approval-handoff-v1.zip` is recorded as the **Intent Authority Design Handoff Candidate** under the canonical Lattice Intent Authority name.

Bound artifact provenance:

- Archive SHA-256: `63933fa9e78e515b1b1c454c746dd3906a46884833571693d366682889218973`.
- Manifest package: `lattice-conversation-drift-design-approval-handoff-v1`.
- Manifest status: `AWAITING_DESIGN_APPROVAL`.
- Research revision recorded by the package: `cad448809a8f02df6d31de4e516cd1df21d5b456`.
- Core candidate principle: `Transcript is context and provenance. Versioned structured intent is authority.`
- Candidate mechanisms include immutable IntentVersion state, Product-owned semantic delta reduction, server-owned transition metadata, USER-origin/evidence binding, semantic equality, clarification state, unresolved conditional handling, selective USER provenance retrieval, and exact downstream intent-version binding.

**Confirmed by Owner:** the subsystem is canonically named **Lattice Intent Authority**, and its authority domain is versioned user intent rather than transcript text, external truth, decision ranking, or presentation.

**Not promoted by this update:** the detailed candidate architecture remains proposed. Its synthetic experiment results are evidence about the candidate architecture under the declared simulation, not real-interpreter quality, repository implementation correctness, or production readiness. OD-004 remains open until the architecture is separately accepted/incorporated into a qualified Product source.

# 4. Architecture Principles and Authority Boundaries

## 4.1 Authority map

| Concern | Canonical owner at 1.0 | May not do |
|---|---|---|
| User intent | Lattice Intent Authority | Cannot rewrite user intent to match a preferred recommendation; cannot treat assistant/model text as USER authority without a qualified user-supported contract. |
| Operational lifecycle | Lattice Execution Runtime | Cannot establish external truth or decision semantics. |
| Research execution | Lattice Execution Runtime research components | Cannot admit evidence or set Lattice truth confidence. |
| Model invocation | Lattice Model Gateway | Cannot establish user intent, external truth, eligibility/ranking, winner state, or Product validation. |
| External factual truth | V36 Truth Core | Cannot adopt provider confidence or feature-specific shortcuts as truth. |
| Eligibility/ranking | Lattice Decision Engine | Cannot strengthen V36 truth, treat unknown hard constraints as satisfied, or override failed constraints with preference score. |
| Human explanation / conversation presentation | Solandra Experience | Cannot change persisted intent, truth, winner, constraints, or add unsupported material claims. |
| User continuity | Lattice Intent Authority + conversation continuity state | Cannot turn remembered external-world claims into current fact without V36. |
| Offline model/API simulation | V7 LLM Simulation Lab | Cannot become Product authority or be described as Lattice Product validation merely because it exercises the Model Gateway boundary. |

## 4.2 Design laws

- Structured authority before generated prose.
- Canonical system names preserve authority boundaries; a rename or process split does not transfer authority or validation between systems.
- Durability is achieved with persisted state + idempotency + CAS; exactly-once delivery is not assumed.
- Research parallelism changes latency, not proof meaning.
- Unknown or exhausted evidence remains explicit uncertainty; no downstream layer relaxes the proof burden.
- User intent, operational state, truth state, decision state, and explanation remain separate models even when one workflow touches all of them.
- The simplest deployment that satisfies correctness wins; process separation is preferred before service separation.
- Every long-running operation is cancellable and bounded by budget/deadline/attempt policy.
- Interfaces make ownership, lifecycle, cancellation, error semantics, idempotency, and observability explicit.
- Schema evolution is forward-only by default and release-safe; startup never silently mutates production schema.

# 5. Target 1.0 Architecture

```text
+---------------------------+
| Solandra Experience       |
| Client / conversation UI  |
+-------------+-------------+
              | HTTPS / SSE
              v
+-------------------+   +-------------------------+   +---------------------+
| Identity Provider | ->| API / Product boundary  | ->| PostgreSQL          |
+-------------------+   +------------+------------+   | product/ops state   |
                                     |                +----------+----------+
                                     v                           ^
                        +------------+-------------+             |
                        | Lattice Intent Authority |             |
                        | intent / clarification   |             |
                        +------------+-------------+             |
                                     | confirmed intent          |
                                     v                           |
                        +------------+-------------+             |
                        | Lattice Execution Runtime| <-----------'
                        | Run coordinator +        |
                        | research scheduling/work |
                        +------+-----------+-------+
                               |           |
                   untrusted research      | model capability where qualified
                               |           v
                               |    +------+---------------+
                               |    | Lattice Model Gateway|
                               |    +------+---------------+
                               |           |
                               v           | model output remains non-authoritative
                        +------+-----------+------+
                        | V36 Truth Core          |
                        | protected epistemic core|
                        +-----------+-------------+
                                    |
                                    v
                        +-----------+-------------+
                        | Lattice Decision Engine |
                        +-----------+-------------+
                                    |
                                    v
                        +-----------+-------------+
                        | Solandra Experience     |
                        | faithful presentation   |
                        +-------------------------+
```

The V7 LLM Simulation Lab is outside this Product-authority diagram. It may exercise the Lattice Model Gateway in prototype development without becoming a Product runtime dependency or authority.

## 5.1 Module boundaries inside the codebase

Module/package names are implementation organization, not alternative system names.

| Module / package | Canonical system mapping | Responsibility | Dependencies |
|---|---|---|---|
| product/intent | Lattice Intent Authority | Conversation input, intent versions, clarification, user priorities/constraints. | Lattice Model Gateway when qualified; no V36 dependency unless validating an external-world claim. |
| product/planning | Lattice Intent Authority / Product planning | Builds an executable DecisionPlan from confirmed intent. | Intent state; domain/criterion registry; may request V36 research requirements through the truth coordinator. |
| runtime/run | Lattice Execution Runtime | Run lifecycle, CAS transitions, cancellation, phase coordination. | Stores + truth/decision interfaces; no provider SDKs. |
| runtime/orchestration | Lattice Execution Runtime | Research task DAG, leases, retries, outbox dispatch. | Run epoch + task definitions; no truth semantics. |
| model | Lattice Model Gateway | Provider-neutral model capability contracts/adapters and bounded runtime semantics. | Model providers/simulators; no Product authority. |
| truth/v36 | V36 Truth Core | Claim/provenance/proof/admission/adjudication/fidelity semantics. | Provider-neutral evidence/research result contracts only. |
| research | Lattice Execution Runtime research capability | Provider adapters, retrieval execution, artifact normalization, timeouts/budgets. | External providers; outputs untrusted candidate artifacts/evidence. |
| decision | Lattice Decision Engine | Typed criteria, eligibility, utility/ranking, tradeoff/sensitivity. | Validated/admitted V36 decision evidence + confirmed user intent. |
| presentation/solandra | Solandra Experience | Progress presentation and human-readable result. | Read-only persisted intent/truth/decision state + Lattice Model Gateway where qualified. |
| api | Lattice Product boundary | HTTP/SSE, auth binding, idempotency, DTO validation. | Product/runtime interfaces only. |
| persistence/postgres | Shared persistence implementation | Concrete repositories, transactional boundaries, migrations. | Domain contracts; no Product policy. |

# 6. Domain and State Model

## 6.1 Sources of truth

| Entity | Source of truth | Writers | Lifetime / recovery |
|---|---|---|---|
| User / subject | Identity adapter + local subject mapping | Auth/account boundary only | Long-lived; deletion policy required before 1.0. |
| Conversation | PostgreSQL | API/Product layer | Long-lived until user deletion/retention expiry. |
| Message | PostgreSQL append-only logical history | API/Product layer | Conversation lifetime; edits represented as new correction/revision events. |
| IntentVersion | PostgreSQL versioned record | Lattice Intent Authority | Per conversation/decision episode; superseded versions retained for traceability. |
| Run | PostgreSQL | Lattice Execution Runtime / API control | Durable until retention/delete; status/version is execution epoch. |
| RunEvent | PostgreSQL ordered append | Lattice Execution Runtime | Durable audit/progress history. |
| ResearchTask / Attempt | PostgreSQL | Lattice Execution Runtime research components | Run-scoped durable execution state. |
| ProviderResult | PostgreSQL metadata + optional artifact storage | Research worker only | Immutable untrusted result; accepted use decided by V36 Truth Core. |
| TruthSnapshot / TruthBundle | PostgreSQL | V36 Truth Core persistence boundary | Authoritative Run-scoped truth state. |
| StructuredDecision | PostgreSQL | Lattice Decision Engine through guarded Run store | Immutable authoritative decision for completed decision step. |
| Explanation | PostgreSQL | Solandra Experience through guarded completion | Derived from persisted authority; may be regenerated only under explicit versioned policy. |
| IdempotencyRecord | PostgreSQL | API control boundary | Retention-bounded; scoped to authenticated subject. |

## 6.2 Proposed conversation model

```text
Conversation
  id
  subjectId
  status: ACTIVE | ARCHIVED | DELETED
  createdAt / updatedAt

Message
  id
  conversationId
  role: USER | SOLANDRA | SYSTEM_EVENT
  content
  createdAt
  correlationRunId?

IntentVersion
  id
  conversationId
  version
  goal
  constraints[]
  preferences[]
  materialUnknowns[]
  confirmationState
  supersedesIntentVersionId?
```

Recommendation: preserve message history and correction lineage rather than mutating prior user intent in place. A new user correction should create a new IntentVersion and become controlling for later Runs. The exact reducer/provenance/persistence semantics remain OD-004 and are not silently settled by the recorded Intent Authority design handoff candidate.

# 7. Run Lifecycle and Durable Coordination

## 7.1 Keep the existing high-level Run statuses

```text
CREATED
-> UNDERSTANDING
-> AWAITING_CLARIFICATION -> UNDERSTANDING
-> PLANNING
-> INVESTIGATING
-> VALIDATING
-> DECIDING
-> COMPLETED

Active states may reach CANCELLED or FAILED where allowed.
```

Recommendation: do not add worker-implementation states such as QUEUED, RETRYING, or WAITING_PROVIDER to the Product Run status unless they are materially useful to users or correctness. Task/attempt/outbox state already represents those details. Run status should remain a small Product-level lifecycle.

## 7.2 Refactor execution from “run to completion” into resumable phase ticks

```text
RunCoordinator.tick(runId) ->
  COMPLETED | TERMINAL | WAITING | ADVANCED

Example INVESTIGATING tick:
1. Load Run status/version.
2. Ask V36/truth coordinator what research work is required.
3. Idempotently schedule task graph bound to current Run epoch.
4. If tasks are pending, persist any permitted non-authoritative work state and return WAITING.
5. Task completion emits/re-enables a run dispatch.
6. Later tick consumes immutable results through V36 and advances only with a valid truth checkpoint.
```

Correctness remains based on Run status/version CAS. Worker delivery remains at-least-once. A stale worker may perform no accepted side effect after losing the Run epoch.

## 7.3 Cancellation

- Cancellation is authoritative Product state, not merely a provider hint.
- A cancel transition invalidates future Run-epoch task acceptance; in-flight provider calls receive best-effort cancellation.
- Late task/provider results remain immutable historical attempt data but are stale and cannot enter accepted truth state.
- Run workers acknowledge terminal dispatches without resuming work.
- User-facing cancellation should become observable promptly; exact cancellation SLO remains OD-009.

# 8. Lattice Intent Authority, Clarification, and Planning

## 8.1 Intent interpretation is not truth adjudication

User goals, values, constraints, and priorities belong to the person. Lattice Intent Authority owns the canonical structured Product state representing that intent. A model may help interpret or structure user language through Lattice Model Gateway, but model output is a proposal and a material model inference must not silently become controlling user intent. Intent is stored separately from V36 because it is not an external-world factual authority problem.

**Confirmed:** the canonical subsystem name and authority boundary are Lattice Intent Authority.

**Still Proposed / OD-004:** the exact transition/reducer/persistence/provenance contract. The external Intent Authority Design Handoff Candidate provides bounded candidate evidence and does not independently authorize implementation of all of its mechanisms.

## 8.2 Proposed intent pipeline

1. Persist the user message before model interpretation.
2. Lattice Model Gateway may produce a schema-validated intent proposal: objective, candidate domain, hard constraints, preferences, known context, material unknowns, or semantic delta according to the eventual qualified contract.
3. Product-owned Intent Authority policy compares proposals with user-supported state and classifies material explicit, inferred, or unresolved meaning.
4. If an inferred/unresolved item can materially change the resulting decision, enter AWAITING_CLARIFICATION and ask the smallest useful question.
5. User correction creates a new IntentVersion under the qualified reducer/version contract. The new version becomes controlling for future work without rewriting historical versions.
6. Once materially sufficient, Planning creates a DecisionPlan bound to the exact confirmed IntentVersion ID.

## 8.3 DecisionPlan contract

```text
DecisionPlan
  id
  runId
  intentVersionId
  candidateStrategy
  criteria: CriterionDefinition[]
  evidenceRequirements[]
  researchBudget
  deadline
  domainStrategyId?
  planVersion
  createdAt
```

The plan is operational state. It may request evidence/research, but it does not decide whether returned evidence is true. The planVersion participates in durable research task fingerprints so replanning cannot accidentally accept stale work.

# 9. Research and Provider Architecture

## 9.1 Boundary contract

**Core rule:** Providers return untrusted artifacts and candidate evidence. V36 Truth Core owns provenance normalization, verification, proof obligations, admission, contradiction handling, and truth verdicts. Provider confidence is never directly converted to Lattice truth confidence.

Lattice Model Gateway is specifically the Product-owned model-capability boundary. General research scheduler/worker/provider-adapter components remain operational parts of Lattice Execution Runtime unless a later qualified design establishes another canonical top-level system. Naming a provider adapter does not grant it Product authority.

## 9.2 Proposed provider-neutral request/result contracts

```text
TruthResearchRequest
  requestId
  runId
  claimId
  purpose
  query / structured retrieval target
  requiredSourceCharacteristics
  temporalBounds?
  maxResults
  deadline
  budgetClass

ResearchExecutionResult
  requestId
  taskId / attemptNumber
  providerId
  artifacts[]
  candidateEvidence[]
  providerMetadata
  startedAt / completedAt
  outcome: SUCCEEDED | FAILED | CANCELLED

Important: ResearchExecutionResult is never authoritative truth.
```

## 9.3 Durable research integration with V36

The integration must preserve the truth-core rule that orchestration cannot understand or weaken proof semantics. Recommended interaction: V36 emits research intents (including falsification/corroboration purposes); Lattice Execution Runtime schedules/executes them; V36 consumes immutable results and determines the next epistemic step. Conditional second-origin recovery and contradiction verification therefore remain V36-directed even though the work is durable and parallelized.

Open design detail: the exact persisted intermediate V36 work-state contract needs a Truth-Core Work Item or equivalent protected-core design review because today’s authoritative snapshots are only INVESTIGATED and VALIDATED. See OD-002.

## 9.4 Budgets, retries, and provider policy

- Each Run has a total research budget and deadline; each task has max attempts and an individual timeout.
- Retries are allowed only for retryable execution failures, not to manufacture corroboration by repetition.
- Provider choice is an operational routing decision constrained by research requirements; it does not carry epistemic authority.
- Equivalent provider results should be deduplicated by artifact/provenance semantics before they can count as independent support.
- Budget exhaustion produces explicit unresolved truth state and may prevent a definitive decision.
- All provider calls carry runId/taskId correlation and must be cancellable where the provider API supports cancellation.

# 10. V36 Truth Core at 1.0

## 10.1 Protected semantics

- Material external-world assertions are typed before proof obligations are evaluated.
- Proof obligations remain deterministic by claim type under the active qualified contract.
- Source count, repeated rediscovery, or model agreement do not establish independence.
- Unsupported positive claims become UNVERIFIED rather than being converted to FALSE.
- Verified conflict remains MIXED; contradictory evidence cannot be erased by positive support.
- Current-state evidence can become OUTDATED when temporal applicability fails.
- Rejected, unresolved, misleading, mixed, false, or outdated evidence cannot masquerade as positive factual decision evidence.
- Causal/authenticity positives retain their independent-corroboration burden.
- Decision evidence is same-Run unless a separately qualified reusable-evidence contract is introduced.
- Generated prose cannot mutate truth or decision authority.

## 10.2 Live-provider promotion gate

A live provider is not enabled merely because the adapter works. The first live integration is a separately qualified Work Item comparing exact live-provider behavior to the accepted offline V36 baseline. Required evidence includes provider-result untrustedness, provenance handling, corroboration semantics, contradiction/falsification behavior, temporal applicability, bounded exhaustion, and decision/explanation fidelity.

Recommendation: keep v36-offline as a permanent deterministic test mode even after live mode exists. Production/live modes should add capabilities, not remove the reproducible acceptance surface.

# 11. Lattice Decision Engine 1.0

## 11.1 Why the current scoring model must evolve

The current prototype normalizes user weights but adds raw numeric criterion values directly. That is adequate for a controlled fixture where all values are intentionally comparable, but it is not a safe general decision model across price, battery life, performance, risk, quality, categorical preferences, or domain-specific scales.

## 11.2 Proposed criterion model

```text
CriterionDefinition
  id
  label
  role: HARD_CONSTRAINT | PREFERENCE
  valueType: NUMBER | BOOLEAN | CATEGORY | ORDINAL
  unit?
  direction?: HIGHER_BETTER | LOWER_BETTER | TARGET
  constraintPredicate?
  utilityFunction? // maps admitted value -> [0,1]
  missingEvidencePolicy
  materiality / evidenceRisk?

CandidateCriterionResult
  criterionId
  truthAssessmentIds[]
  observedValue?
  constraintState: PASS | FAIL | UNKNOWN
  utility?
  explanationReason
```

## 11.3 Eligibility and ranking semantics

- Eligibility becomes tri-state at criterion level: PASS, FAIL, UNKNOWN. A candidate is ELIGIBLE only when every hard constraint is PASS.
- A FAIL is an established violation. UNKNOWN means Lattice could not establish the requirement; it is not silently rewritten as failure in the explanatory model even though it cannot satisfy eligibility.
- Preference utility is criterion-specific and normalized to a common [0,1] scale before weighting.
- Missing preference evidence follows an explicit policy: omit-and-renormalize, conservative floor, or mark ranking unstable. The policy must be defined by criterion/domain rather than accidental null handling.
- Winner selection uses eligible candidates only. Hard constraints cannot be overridden by utility score.
- Tie policy is explicit and deterministic. Recommended default: report a tie when score difference is within a configured equality tolerance unless a secondary criterion is explicitly defined.
- StructuredDecision includes tradeoffs, uncertainty/coverage, and ranking stability rather than only winner + raw score.

## 11.4 Proposed StructuredDecision evolution

```text
StructuredDecision
  runId
  intentVersionId
  planVersion
  goal
  outcome: WINNER | TIE | NO_ELIGIBLE_CANDIDATE | INSUFFICIENT_EVIDENCE
  winnerCandidateId?
  tiedCandidateIds[]
  evaluations[]
  tradeoffs[]
  materialUnknowns[]
  sensitivity?
  evidenceIds[]
  truthAssessmentIds[]
  decisionModelVersion
  createdAt
```

# 12. Solandra Experience and Explanation Fidelity

## 12.1 Role

Solandra Experience is the coherent Product-facing presentation and interaction layer. It may simplify, organize, adapt, and progressively disclose authoritative Product state to the user, but it is never Lattice Intent Authority, V36 Truth Core, or Lattice Decision Engine.

The Owner-approved offline-prototype design establishes the Living Consultation / Knowledge Crystallization interaction direction for its bounded scope. That design approval does not by itself prove implementation behavior.

## 12.2 Recommended 1.0 explanation architecture

1. Build an ExplanationContext exclusively from persisted intent, validated truth, StructuredDecision, and explicitly permitted non-material presentation metadata.
2. Generate a structured ExplanationPlan containing the winner/outcome, required tradeoffs, material uncertainty, citations/evidence references, and prohibited claims.
3. A deterministic validator checks that every material claim in the plan is licensed by the authoritative state.
4. A model may render prose through Lattice Model Gateway from the validated plan.
5. Post-render validation ensures winner, constraints, uncertainty, evidence references, and decision semantics are unchanged; failure blocks completion or falls back to a deterministic renderer.

This generalizes today’s structured deterministic fidelity boundary without giving a language model authority to add new material facts. A deterministic fallback renderer should remain available for reliability and acceptance tests.

# 13. API and Conversation Contract

## 13.1 API principles

- Versioned API remains asynchronous by default for substantive work.
- HTTP acceptance is idempotent and atomic with initial dispatch.
- Authenticated subject identity is bound server-side; clients cannot choose arbitrary ownership scope.
- Polling remains a durable fallback; a server-sent event stream provides lower-latency progress.
- Progress events are Product-level summaries, not raw internal logs or provider transcripts.
- Cancellation is an explicit write endpoint with idempotent semantics.
- Development-only transient simulated-conversation endpoints are qualification surfaces, not substitutes for durable Lattice Intent Authority or 1.0 conversation persistence.

## 13.2 Proposed 1.0 endpoints

| Method / route | Purpose | Notes |
|---|---|---|
| POST /api/v1/conversations | Create conversation | Returns conversation ID owned by authenticated subject. |
| GET /api/v1/conversations/:id | Read conversation summary | Owner-scoped; includes current intent/result summaries. |
| GET /api/v1/conversations/:id/messages | Read message history | Paginated. |
| POST /api/v1/conversations/:id/messages | Submit user message / correction | Idempotent; may create a new Run or clarification response. |
| GET /api/v1/runs/:id | Poll Run state | Existing concept retained. |
| GET /api/v1/runs/:id/events | Durable event history | Existing concept retained; paginated/cursor-ready. |
| GET /api/v1/runs/:id/events/stream | SSE progress | Reconnect with Last-Event-ID or equivalent sequence cursor. |
| POST /api/v1/runs/:id/cancel | Cancel active Run | Existing CAS semantics retained. |
| GET /api/v1/runs/:id/result | Read authoritative result | Only after completion or terminal outcome contract. |

## 13.3 Error model

API errors should use stable machine-readable codes plus safe human messages. Internal provider/DB details remain in correlated logs. Important categories: validation, ownership/not-found, idempotency conflict, clarification required, terminal-state conflict, rate/budget limit, temporary dependency failure, and internal failure.

# 14. Persistence and Data Architecture

## 14.1 PostgreSQL remains the authoritative store through 1.0

Recommendation: retain PostgreSQL for conversations, Runs, tasks, outbox, idempotency, truth entities/snapshots, decisions, explanations, and operational metadata. Avoid introducing a second durable database until data shape or scale proves it necessary.

## 14.2 Proposed schema additions

| Table / group | Purpose | Key constraints |
|---|---|---|
| users / subjects | Local subject mapping and account state | Stable subject ID; provider identity mapping unique. |
| conversations | Conversation ownership/lifecycle | subject_id indexed; soft-delete/tombstone strategy defined. |
| messages | Append-only logical message history | conversation_id + monotonic sequence or creation ordering. |
| intent_versions | Versioned canonical Lattice Intent Authority state | Unique conversation_id + version; supersedes pointer. |
| decision_plans | Operational plan revisions | Bound to run_id + intent_version_id + plan_version. |
| provider_invocations | Operational provider attempts/metrics | No epistemic authority; sanitized metadata. |
| research artifacts/results | Immutable untrusted retrieval output metadata | Bound to run/task/attempt; content retention policy. |
| existing run/truth/decision tables | Retained and evolved | Run-scoped FK integrity and transactional truth replacement. |

## 14.3 Large artifacts

Working recommendation: keep small normalized evidence/provenance records in PostgreSQL. If live research or file ingestion produces large raw artifacts, store the bytes/content in an object/blob store and persist immutable hashes, canonical location, metadata, and access references in PostgreSQL. Do not add object storage until artifact size/retention requirements make it necessary.

# 15. Authentication, Security, and Privacy

## 15.1 1.0 security boundary

| Risk area | Required 1.0 design |
|---|---|
| Authentication | Trusted auth adapter resolves external identity to immutable internal subject ID. |
| Authorization | Every conversation/Run/result access is subject-scoped on the server. No client-supplied ownership authority. |
| Idempotency | Scope uses real subject ID + method + canonical route + key; conflict semantics preserved. |
| Provider secrets | Server-side secret storage only; never persisted in Run/message state or returned to clients. |
| Untrusted external content | Provider/file content is data, never executable instruction authority; V36 and parser boundaries treat it as untrusted. |
| Logging | Sensitive message/provider content excluded by default; structured identifiers used for correlation. |
| Data deletion | User deletion/retention behavior propagates to conversations, messages, derived states, and user-owned raw artifacts under an explicit policy. |
| Transport | TLS at the deployment boundary; secure service-to-DB/provider connections. |
| Rate/budget abuse | Per-subject and system-level limits for message submission, concurrent Runs, provider budget, and task fanout. |

## 15.2 Unknowns that must not be invented

Specific regulatory obligations, retention periods, encryption-key management requirements, residency constraints, and enterprise/compliance certifications are UNKNOWN until a target market/deployment policy establishes them. The architecture should remain compatible with stronger requirements, but 1.0 should not claim compliance that has not been qualified and tested.

# 16. Continuity and Memory

The Product concept requires continuity, but memory must preserve the difference between what the user wants and what the external world currently supports.

## 16.1 Proposed 1.0 memory scope

- Persist explicit user preferences, constraints, communication preferences, and prior confirmed intent versions through Lattice Intent Authority when the user permits reuse.
- A remembered user preference can influence future planning without V36 because it is person-owned state.
- A remembered external-world fact, source result, or prior recommendation cannot automatically become current decision evidence. Reuse requires a separately qualified evidence-reuse contract or a new V36 evaluation.
- Corrections supersede older user-state inferences while retaining history for traceability.
- Cross-conversation memory beyond explicit preferences is an Open Decision (OD-007) rather than a hidden 1.0 assumption.

# 17. Failure, Recovery, and Idempotency

| Failure | Required behavior |
|---|---|
| API process crashes after acceptance | Run + idempotency response + initial dispatch are already atomic; retry returns existing response. |
| Lattice Execution Runtime worker crashes after Run transition | Next worker reloads persisted status/version and resumes; stale worker cannot overwrite newer epoch. |
| Worker crashes after provider call but before task completion | Lease expires; attempt is retried. Provider operation must be idempotent where possible or duplicate-safe at result admission. |
| Duplicate dispatch | Logical-key/outbox + Run/task CAS makes duplicate delivery harmless. |
| Provider timeout/unavailable | Bounded retry according to task policy; exhaustion returns unresolved research/truth rather than weakened proof. |
| Partial truth write | Transaction rolls back; Run cannot advance with a partially persisted V36 truth snapshot. |
| Cancellation during research | Run becomes CANCELLED; active tasks become stale/cancelled and late results cannot be accepted. |
| Solandra rendering fails | Retry/fallback renderer; persisted decision remains intact. Completion occurs only with fidelity-valid output. |
| Schema missing/outdated | Durable startup fails closed; migration is an explicit deployment step. |
| No eligible decision | Persist terminal decision outcome or failure semantics explicitly; do not fabricate a winner. |

# 18. Observability and Operational Diagnostics

## 18.1 Structured logs

Every log event should carry the smallest useful correlation set: service/process role, runId, conversationId when safe, taskId/attempt when relevant, event name, outcome, duration, and error category. User text and source content are omitted unless explicitly enabled in a protected debugging workflow.

## 18.2 Metrics required before 1.0

| Category | Examples |
|---|---|
| API | accepted requests, idempotent replays/conflicts, validation errors, auth failures, request latency |
| Runs | active/terminal counts, phase durations, completion/cancel/failure rate, stale CAS events |
| Research | task queue depth, lease timeouts, attempts, provider latency/error rate, budget exhaustion |
| Truth | verdict distribution, UNVERIFIED/MIXED/OUTDATED rates, proof-check failures, contradiction/corroboration recovery usage |
| Decision | eligible candidate counts, ties, insufficient-evidence outcomes, ranking instability |
| Database | pool saturation, transaction latency, lock waits, outbox lag |

## 18.3 User-facing progress

Lattice Execution Runtime owns operational lifecycle state; Solandra Experience presents only user-meaningful licensed progress. Progress events should represent meaningful Product phases (understanding, planning, researching, validating, deciding, explaining) and optionally bounded counts when those counts are truthful. They should not expose provider chain-of-thought, raw prompts, secrets, internal stack traces, or implementation-only task states.

# 19. Performance and Scalability

No release SLO values are currently established in the inspected sources, so this design does not invent them. Before 1.0, the Product Owner must bind acceptable latency, concurrency, provider budget, and availability targets (OD-009). The architecture should support those targets without semantic shortcuts.

## 19.1 Scalability approach through 1.0

- Stateless API processes scale horizontally behind the deployment ingress.
- Lattice Execution Runtime Run and research workers scale horizontally using PostgreSQL leases/CAS; no sticky ownership is required.
- Independent research tasks may run concurrently subject to per-Run/global concurrency budgets.
- Database indexes target active Run status, outbox availability/lease, task readiness, subject/conversation ownership, and event sequence queries.
- Retention/archival prevents unbounded growth of events, provider metadata, and raw artifacts.
- Provider concurrency is bounded to protect cost and upstream rate limits.
- Do not cache authoritative current facts outside V36 without an explicit evidence-reuse/freshness contract.

# 20. Runtime Topology and Deployment

## 20.1 Process roles

Process-role names are deployment/implementation roles, not alternative Product-system names.

| Role | Canonical system mapping | Responsibilities | Stateless? |
|---|---|---|---|
| api | Lattice Product boundary | HTTP/SSE, auth, conversation/message writes, async Run acceptance, read APIs | Yes except in-flight connections |
| run-worker | Lattice Execution Runtime | Lease run dispatches, execute RunCoordinator ticks, persist transitions/decisions/explanations through owning interfaces | Yes |
| research-worker | Lattice Execution Runtime | Lease research dispatches, call providers, persist immutable attempt results | Yes |
| migrate/admin | Shared controlled infrastructure | Apply exact ordered schema migrations; maintenance/repair tools | Ephemeral controlled job |

## 20.2 Environment model

| Environment | Truth/provider mode | Purpose |
|---|---|---|
| local deterministic | v36-offline | Fast reproducible development and unit/acceptance work. |
| prototype model simulation | v36-offline + V7 LLM Simulation Lab through Lattice Model Gateway | Offline model/API protocol, fault, idempotency, response-bound, and qualification work without treating simulator output as Product truth or production evidence. |
| development durable | v36-offline + PostgreSQL | Restart/CAS/outbox/task integration and fault injection. |
| live-provider test | qualified live mode, non-production | Compare provider integration against accepted offline baseline. |
| production | qualified live mode | 1.0 service after all release gates pass. |

## 20.3 Startup/readiness

- Every process validates runtime config and required schema version before becoming ready.
- Durable modes fail closed without PostgreSQL or required provider/auth configuration.
- API liveness is distinct from readiness: a process may be alive but not ready when DB/provider dependencies are unavailable.
- Graceful shutdown stops accepting new work, releases/lets leases expire safely, closes SSE connections with reconnect semantics, and closes DB pools.

# 21. Migration and Versioning Strategy

## 21.1 Unify migration authority before async runtime activation

**Proposed decision:** Replace adapter-local migration ownership with one canonical ordered migration registry/runner covering every schema version. Adapter connect() methods verify readiness; they do not silently mutate durable production schema.

This resolves the current split where PostgresRunStore owns 005-016, PostgresOrchestrationStore owns 017-018, PostgresApiRunControlStore owns 019, and db:migrate stops at 016.

## 21.2 Compatibility rules

- Migrations are forward-only by default; destructive changes use expand -> migrate/backfill -> contract across releases.
- Runtime records schema/contract version where semantics may change: decisionModelVersion, truth execution contract ID, and relevant provider/plan version.
- API breaking changes require a new versioned route or explicit compatibility period.
- Rollback is application rollback to a schema-compatible prior release, not arbitrary down-migration unless a specific reversible migration supports it.

# 22. Testing, Evaluation, and Acceptance

## 22.1 Test pyramid / evidence layers

| Layer | Purpose |
|---|---|
| Unit | Pure decision, truth, intent, utility, serialization, and validation semantics. |
| Contract | Lattice Model Gateway/provider-neutral adapters, API DTOs, store interfaces, migration readiness, explanation licensing. |
| Integration | PostgreSQL transactions/CAS/outbox/tasks, Lattice Execution Runtime coordination, cancellation, restart/recovery. |
| Deterministic Product acceptance | Exact offline V36 Truth Core / Lattice Decision Engine / adversarial corpus behavior. |
| Live-provider acceptance | Same protected semantics exercised against provider variability and real provenance/temporal behavior. |
| Security/privacy | Tenant isolation, auth boundaries, secret handling, deletion/retention behavior, abuse controls. |
| Load/reliability | Queue lag, worker recovery, connection pool behavior, retry storms, provider slowdown, cancellation under load. |
| Human/Product evaluation | Does Solandra Experience understand/present the user's confirmed intent correctly, ask appropriate questions, communicate uncertainty, and improve decision usefulness? |

## 22.2 1.0 release gates

| Gate | PASS requires |
|---|---|
| G1 — Repository | Build/tests/check pass on exact release candidate; lockfile/runtime contract satisfied. |
| G2 — V36 Truth Core offline | All protected V36 acceptance, adversarial, contamination, determinism, and fidelity criteria pass. |
| G3 — Lattice Execution Runtime durability | Restart, duplicate dispatch, stale epoch, cancellation, partial transaction, and migration readiness probes pass. |
| G4 — Durable research | Research DAG, retries, dependency release, task cancellation, result staleness, and V36 handoff pass under fault injection. |
| G5 — Live provider | Qualified live-provider suite preserves V36 semantics and bounded exhaustion; no confidence/provenance bypass. |
| G6 — Lattice Decision Engine | Typed criterion/utility tests, unknown handling, tie behavior, sensitivity/coverage, and hard-constraint supremacy pass. |
| G7 — Solandra Experience | Rich explanation cannot change authoritative intent/truth/decision or introduce unsupported material claims; fallback path tested. |
| G8 — Security/privacy | Authenticated isolation, idempotency scope, secret handling, deletion/retention, rate/budget abuse tests pass. |
| G9 — Operations | Health/readiness, logging/metrics, graceful shutdown, alerts/runbooks, backup/restore evidence, deployment rollback evidence. |
| G10 — Product | Owner-approved user-journey acceptance and quality evaluation meet release thresholds. |

# 23. Milestone Plan to 1.0

The sequence is dependency-oriented rather than calendar-oriented. Each Product milestone should end in an identifiable exact revision and acceptance evidence. Prototype external-artifact milestones are instead bound to the exact supplied artifact identities and the evidence actually executed for those artifacts. Multiple milestones can overlap when their authority boundaries are independent.

| Stage | Milestone | Objective | Exit criteria / dependency |
|---|---|---|---|
| Prototype | M0 — Product baseline | Preserve offline V36 + current durable component evidence. | Repository understanding + protected-core acceptance remains green on the applicable exact Product revisions. |
| Prototype | M1 — V7 LLM Simulation Lab | Establish the bounded standalone offline model/API simulation and qualification surface used during prototype development. | External V7 artifact is integrity-bound to `1.7.0-research`, polished bundle SHA `673aea1363458144cdab1961615ac640777f0c2cedb7ef10e3fd3ffc1f23df7e`, and tarball SHA `2233295ca35bc3e59d3f944a850d0ceb770b6009b8ba86e3b8dc6f5e40d3871f`; standalone prototype validation passes while Lattice Product validation and production readiness remain explicitly unclaimed. |
| Prototype | M2 — Solandra Offline Prototype UI Design | Establish the bounded Solandra Living Consultation UX/design target used to guide offline-prototype frontend implementation without moving intent/truth/decision authority into the client. | Owner-approved external archive SHA `36a343029d2f455af1767b853bbd527710b63331efc805b02a672bbb2bbbfcd8`, manifest status `owner-approved-offline-prototype-preimplementation`, baseline `73d707b5921e01b46458381dad633203d8d63af0` / tree `9f98a7ecabe25af895baa0fd1d191eb7bbb40562`; Premium design review is recorded while implementation/browser/accessibility/E2E/production acceptance remains unclaimed. |
| Build to 1.0 | M3 — Lattice Execution Runtime durable composition | Make async API control, canonical migrations, run worker, and orchestration real process roles. | PostgreSQL durable API no longer returns ASYNC_CONTROL_NOT_CONFIGURED; worker handoff/restart/cancel validated end-to-end. |
| Build to 1.0 | M4 — Durable V36 Truth Core research handshake | Route V36-directed research through durable tasks/results. | In-process provider execution is no longer required for live/durable path; Lattice Execution Runtime still cannot adjudicate truth. |
| Build to 1.0 | M5 — Lattice Intent Authority + clarification + planning | Accept normal-language goals and persist versioned authoritative user intent. | OD-004 resolved through a qualified design; clear requests proceed; material ambiguity enters AWAITING_CLARIFICATION; corrections preserve historical intent versions; downstream work binds exact confirmed intent version. |
| Build to 1.0 | M6 — Lattice Decision Engine generalization | Introduce typed criteria, utility normalization, tri-state constraint state, explicit tie/outcome semantics. | Multi-criterion cross-scale tests pass; hard constraints remain truth-gated. |
| Build to 1.0 | M7 — Conversation + progress API | Persist messages/conversations and add reliable progress stream. | Reconnectable progress + polling + history work across restart; user-visible lifecycle coherent. Development-only simulated conversation does not satisfy this exit gate. |
| Build to 1.0 | M8 — Auth + privacy + continuity | Replace fixture subject; add isolation, preference continuity, deletion/retention foundations. | Cross-user access probes fail closed; user corrections/preferences persist correctly. |
| Build to 1.0 | M9 — Live-provider promotion | Qualify and enable first live research/model provider path. | Offline-to-live acceptance passes on exact revision; dormant/fail-closed behavior remains for unqualified modes. |
| Build to 1.0 | M10 — Solandra Experience 1.0 explanation | Add richer model-assisted result rendering with deterministic licensing/fallback. | Fidelity/adversarial explanation suite passes; uncertainty/tradeoffs/citations are usable. |
| Production / release | M11 — Production operations | Production topology, observability, backups, limits, SLOs, load/security tests, rollback. | Operational gates G8/G9 pass; target SLOs bound and measured. |
| Production / release | M12 — 1.0 stabilization | Freeze scope, resolve release-blocking open decisions, run full RC program. | All G1-G10 gates pass on the exact candidate revision; known limitations documented and accepted. |

## 23.1 Critical dependency chain

```text
Prototype foundation: M0 Product baseline + M1 V7 Simulation Lab + M2 Solandra offline UI design
                                                               |
                                                               v
M3 Lattice Execution Runtime durable composition
-> M4 Durable V36 Truth Core research
-> M9 Live provider promotion

M5 Lattice Intent Authority/planning
-> M6 Lattice Decision Engine generalization
-> M10 Solandra Experience 1.0 explanation

M7 Conversation/progress + M8 Auth/privacy
----------------------------------------> M11 Production operations

All paths --------------------------------------------> M12 1.0 stabilization
```

# 24. Risks, Unknowns, and What Could Change the Design

| Risk / unknown | Impact | Mitigation / design response |
|---|---|---|
| 1.0 scope is broader/narrower than working assumption | May add/remove milestones and data/security requirements. | Keep capability scope explicit; Owner correction updates target without rewriting current baseline. |
| Durable research handshake contaminates V36 semantics | Highest architectural risk. | V36 emits/consumes research contracts; Lattice Execution Runtime never decides proof/admission; qualify any truth-state change. |
| Lattice Intent Authority over-accepts model interpretation | Could silently mutate controlling user intent. | Resolve OD-004 with Product-owned transition/reducer/provenance semantics; model output remains proposal; fail closed on material ambiguity. |
| Generic Lattice Decision Engine becomes another hidden expert system | Could produce misleading rankings across domains. | Typed criteria + explicit utility/domain adapters + sensitivity/unknown reporting. |
| Provider variability causes nondeterministic acceptance drift | Could weaken trust core. | Permanent offline mode, V7 Simulation Lab, live-provider acceptance corpus, provenance normalization, bounded policy. |
| PostgreSQL outbox becomes a bottleneck | May limit throughput or cause lock contention. | Measure first; index/partition/batch/worker tuning. Introduce broker only with evidence. |
| Model-generated Solandra explanation adds unsupported facts | Could bypass decision authority. | Structured ExplanationPlan, deterministic licensing, post-render validation, fallback renderer. |
| Memory leaks stale external facts into future Runs | Could bypass same-Run truth. | Separate person-owned preference memory from factual evidence; require V36 for factual reuse. |
| Auth/privacy work arrives late | Can force schema/API rewrites. | Add subject ownership to core Product entities before public/live 1.0 data accumulation. |
| Operational SLO/cost targets are unknown | Architecture may be over/under-built. | Bind OD-009 before production scale decisions. |
| File ingestion added to 1.0 late | Expands parser security, storage, provenance, privacy scope. | Resolve OD-010 early or defer explicitly. |

# 25. Open Decisions and Proposed ADR Register

## 25.1 Open decisions

| ID | Decision | Why it matters | Needed by |
|---|---|---|---|
| OD-001 | Confirm the exact Product definition/scope of “1.0”. | Controls release gates and which capabilities are must-have versus deferred. | Before M5/M7 scope locks |
| OD-002 | Define the protected V36 intermediate state/research handshake for durable multi-round research. | Determines how V36 can yield/resume without Lattice Execution Runtime acquiring truth semantics. | M4 |
| OD-003 | Choose the 1.0 Lattice Decision Engine criterion/utility model and domain extension mechanism. | Controls meaningful ranking across heterogeneous criteria. | M6 |
| OD-004 | Finalize Lattice Intent Authority conversation/message/intent persistence, Product-owned transition/reducer, provenance, clarification, semantic-version, and correction semantics. | Controls canonical user-intent authority, continuity, auditability, and exact downstream intent-version binding. The external Intent Authority Design Handoff Candidate is relevant evidence but not yet controlling architecture. | M5/M7 |
| OD-005 | Select first qualified model/research provider(s) and provider-routing policy. | Controls live integration surface, cost, latency, and evaluation. | M9 |
| OD-006 | Define the generalized Solandra Experience explanation licensing/fidelity contract. | Allows rich prose without losing intent/truth/decision authority. | M10 |
| OD-007 | Define cross-conversation memory scope and user controls. | Controls continuity/privacy and stale-fact risk. | M8 |
| OD-008 | Bind concrete production deployment platform/process topology. | Maps platform-neutral process roles to deployment resources and scaling. | M11 |
| OD-009 | Set 1.0 SLOs, concurrency, provider budget, and availability targets. | Needed for load design, capacity, retry policy, and release acceptance. | M11 |
| OD-010 | Decide whether general file/document ingestion is in 1.0. | Materially expands storage, parsing, provenance, security, and privacy scope. | Before M9/M11 |

## 25.2 Initial ADR recommendations

| ADR | Status | Recommendation |
|---|---|---|
| ADR-P001 | Proposed | Keep one modular codebase through 1.0; separate API/run-worker/research-worker process roles rather than microservices. |
| ADR-P002 | Proposed | Use PostgreSQL transactional outbox/leases as the queue backbone through 1.0 unless measured limits require a broker. |
| ADR-P003 | Proposed | Centralize schema migration ownership; runtime adapters verify schema and never auto-migrate durable production state. |
| ADR-P004 | Confirmed architectural law | V36 Truth Core remains the protected epistemic authority for material external-world facts. |
| ADR-P005 | Proposed | Adopt typed criteria with criterion-specific utility mapping and tri-state hard-constraint evaluation in Lattice Decision Engine. |
| ADR-P006 | Proposed | Make the versioned API asynchronous by default; polling remains fallback and SSE provides progress. |
| ADR-P007 | Proposed | Generalize Solandra Experience fidelity with structured licensing + deterministic validation + fallback renderer. |
| ADR-P008 | Confirmed Owner decision | Use the canonical system registry and suffix grammar in `docs/design/Lattice-System-Registry-and-Naming.md`; terminology changes do not transfer authority or validation between systems. |

# 26. Living Document Update Protocol

## 26.1 Every substantive design session should update

- Confirmed requirements or Owner decisions.
- Working assumptions that became confirmed, changed, or invalid.
- Open-decision status and new dependencies.
- Accepted/rejected options with the material reason.
- Repository baseline and implemented-vs-target status when code changes materially.
- Release milestone status and acceptance evidence.
- Risks whose probability/impact materially changed.
- Canonical system names when new systems/boundaries are introduced or terminology drifts.

## 26.2 Change log

| Version | Date | Repository baseline | Change |
|---|---|---|---|
| 0.1 | 2026-08-26 | 2653019e9a9af2daca02c03ac9046c1ea6af213a | Initial living 1.0 design baseline created from repository study. Establishes proposed 1.0 scope, target architecture, milestones, gates, and open decisions. |
| 0.2 | 2026-08-26 | 2653019e9a9af2daca02c03ac9046c1ea6af213a | Owner designated the living design as the canonical Product design and roadmap source; item-level status remains controlling and SPEC-1/V36 detailed contracts remain normative where not explicitly superseded. |
| 0.3 | 2026-08-26 | d5cb6369a95ff6b9d0ec1d0598d0de258d58f280 | Owner placed the external V7 offline LLM simulation lab in the prototype stage. Records exact V7 artifact provenance and non-Product interpretation boundary; inserts V7 as M1 and shifts the prior forward M1-M10 sequence to M2-M11 with dependent references updated. Also reconciles the current explicit Solandra presentation boundary. |
| 0.4 | 2026-08-26 | 73d707b5921e01b46458381dad633203d8d63af0 | Reconciles the merged provider-neutral offline model boundary and Owner placement of the external Solandra UI Design Package v2 in the prototype stage. Records exact package provenance and pre-implementation/nonclaim boundaries; inserts the package as M2 and shifts the prior forward M2-M11 sequence to M3-M12 with dependent references updated. |
| 0.5 | 2026-08-26 | cad448809a8f02df6d31de4e516cd1df21d5b456 | Reconciles the development-only simulated-conversation surface; installs the Owner-approved canonical Lattice system registry/naming convention; names the user-intent subsystem Lattice Intent Authority while retaining its uploaded drift architecture as a candidate under OD-004; records the Owner-approved Solandra offline-prototype UI package and exact artifact hash; updates authority maps, roadmap terminology, system flow, risks, and ADR register without changing V36 or decision semantics. |

# 27. Proposed 1.0 Definition of Done

Under the current working definition of 1.0, the release is not complete merely because the API is deployed or a live provider returns answers. The exact candidate revision must satisfy all of the following observable outcomes:

- A new authenticated user can create a conversation and state a decision goal in normal language.
- Lattice Intent Authority preserves explicit user intent, version/correction history, and asks only decision-critical clarifying questions when materially necessary.
- Lattice Execution Runtime durably accepts a Run with idempotent semantics and the Run can be polled, streamed, cancelled, restarted, and safely redelivered.
- Research is bounded, durable, provider-neutral, and produces untrusted artifacts/results that cannot bypass V36 Truth Core.
- V36 protected semantics pass the full offline suite and the qualified live-provider acceptance suite.
- Lattice Decision Engine uses typed criteria, does not mix incomparable raw scales, does not let preference score override hard constraints, and explicitly represents insufficient evidence/ties.
- StructuredDecision and authoritative truth are persisted before human-readable explanation.
- Solandra Experience communicates the outcome, tradeoffs, material uncertainty, and evidence without changing authoritative intent, truth, or decision state or inventing material facts.
- Conversation history, confirmed preferences, corrections, Runs, decisions, and results survive supported restart and remain subject-isolated.
- Security/privacy controls, rate/budget controls, observability, backup/restore, graceful shutdown, migration readiness, load targets, and rollback procedures have reproducible acceptance evidence.
- Known limitations are documented and explicitly accepted rather than hidden behind a “1.0” label.

# Appendix A. Repository Source Basis for the Baseline

| Area | Primary sources |
|---|---|
| Product / architecture | docs/specifications/Lattice-Product-Concept.txt; docs/specifications/SPEC-1-Lattice-Rebuilt/; docs/specifications/V36-Truth-Layer/README.md; docs/design/Lattice-System-Registry-and-Naming.md |
| Runtime / API | src/app.ts; src/index.ts; src/runtime-config.ts; src/api-control-store.ts; src/postgres-api-control-store.ts |
| Run / decision | src/domain.ts; src/run-store.ts; src/postgres-run-store.ts; src/run-execution.ts; src/run-worker.ts; src/engine.ts |
| Orchestration | src/orchestration-store.ts; src/postgres-orchestration-store.ts; migrations/017-018 |
| V36 Truth Core | src/truth/*; especially types.ts, contracts.ts, admission.ts, adjudication.ts, provenance.ts, snapshot.ts, execution-pipeline.ts, fidelity.ts |
| Lattice Model Gateway | src/model/*; test/model-boundary.test.ts; docs/development/offline-model-simulator-v7.md |
| Solandra Experience | src/presentation/solandra/*; src/truth/fidelity.ts; current development-only simulated-conversation surface/tests/docs |
| Migrations | migrations/005_runs.sql through migrations/019_api_idempotency.sql; src/migrate.ts |
| Tests / CI | test/*.test.ts; .github/workflows/* validation lanes |
| Deployment | render.yaml; package.json; README.md; AGENTS.md |
| External prototype artifact — model simulation | Owner-supplied V7 LLM Simulation Lab polished bundle; exact hashes recorded in §3.1 and M1. |
| External Product design artifact — Solandra UI | Owner-approved `lattice-solandra-ui-design-package-offline-prototype-approved.zip`; exact hash and validation boundary recorded in §3.2 and M2. |
| External design candidate — Lattice Intent Authority | Owner-supplied `lattice-conversation-drift-design-approval-handoff-v1.zip`; archive SHA `63933fa9e78e515b1b1c454c746dd3906a46884833571693d366682889218973`; detailed architecture remains candidate under OD-004. |

# Appendix B. Near-Term Implementation Sequence (Recommended)

The V7 LLM Simulation Lab and Owner-approved Solandra offline-prototype UI design are recorded as completed external prototype-stage inputs. The Intent Authority Design Handoff Candidate is recorded as candidate evidence for M5, not as completed implementation or a promoted architecture. The forward Product implementation sequence therefore begins with M3.

1. Create one Lattice Execution Runtime application composition module that constructs all PostgreSQL stores/adapters explicitly and can be reused by API and workers.
2. Create one canonical migration registry/runner for 005-019+ and make durable process startup verify schema readiness only.
3. Add executable run-worker and research-worker entrypoints/process roles with graceful shutdown and lease-safe loops.
4. Refactor Run execution into a resumable coordinator tick contract while preserving existing Run CAS and current offline path tests.
5. Design/qualify the V36 Truth Core durable research handshake (OD-002) before connecting live or durable provider work.
6. Resolve OD-004 and qualify the detailed Lattice Intent Authority transition/persistence/provenance contract; use the external handoff as candidate evidence rather than automatic implementation authority.
7. Introduce typed criteria and a versioned Lattice Decision Engine model before generalized domains are enabled.
8. Add authenticated subject ownership and progress streaming before accumulating real multi-user live-provider data.
9. Promote the first live provider only through a separate exact-revision acceptance Work Item.
10. Generalize Solandra Experience explanation only after StructuredDecision v1 and its fidelity/licensing contract are stable.

**Design baseline conclusion:** The path to Lattice 1.0 should not be a rewrite. It should be a controlled expansion of the current truth-first architecture: make Lattice Intent Authority person-centered and versioned, make Lattice Execution Runtime durable and asynchronous, make research live but still untrusted, keep V36 Truth Core authoritative, make Lattice Decision Engine semantics general enough for real domains, and make Solandra Experience richer without allowing prose, model providers, or simulation labs to become alternate sources of authority.
