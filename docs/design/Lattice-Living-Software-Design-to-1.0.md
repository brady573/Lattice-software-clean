**LATTICE**

**Living Software Design**

Path from the repaired Product architecture to the 1.0 release

**Canonical Living Design 0.10 | September 3, 2026**

Repository reconciliation baseline: brady573/Lattice-software-clean main @ 3de31612c46a3e31a70e6977f6e100d20bb6be85

Repository authority: Owner-approved on August 26, 2026 as the canonical living Product design source for Lattice direction and 1.0 sequencing. Item-level status remains controlling: Confirmed items are authoritative; Working assumptions remain reversible; Proposed and Open decision items remain non-authoritative until separately accepted.

**Document purpose**

Define a coherent, implementation-oriented path from the repaired Product architecture to a production-capable Lattice 1.0 while preserving its authority boundaries and the protected V36 epistemic contract. This is a living design: confirmed requirements and decisions are separated from working assumptions and open decisions, and future revisions should record why the design changed.

**Design authority**

`The-Core-Lattice-Philosophy.md` is the highest Product-design authority and the first filter for every statement in this document. This Living Design governs implementation direction and roadmap sequencing only where it conforms to the Core. Explicit later Owner decisions, protected V36 contracts, and qualified domain architectures remain controlling within their bounded authority, but none may contradict the Core. Older text and amendments describing Lattice 1.0 as a mandatory StructuredDecision product are superseded by the September 3, 2026 Core reconciliation recorded here.

# 0. Document Control and Living-Design Rules

| Field | Value |
|---|---|
| Document status | Owner-approved canonical living Product design baseline; not a blanket approval of Proposed or Open decision items. |
| Version | 0.10 |
| Repository baseline | main @ 3de31612c46a3e31a70e6977f6e100d20bb6be85 |
| Current implementation mode | Repaired canonical Product architecture with Intent Authority, conditional DecisionPlan/Decision Engine, generic V36 truth execution, Knowledge and Action Preparation outcomes, durable/async components, and Conversation + Composer Solandra presentation. Legacy and simulation routes are explicit non-canonical compositions. |
| Target | First production-capable 1.0 release of trustworthy knowledge with conditional decision capability. |
| Primary authority | `The-Core-Lattice-Philosophy.md`, then conforming explicit Owner decisions, qualified Product sources, this document's Confirmed items, and protected bounded contracts. |
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

## 0.3 Confirmed meaning of “1.0”

**Confirmed Core-aligned release definition:** Lattice 1.0 makes trustworthy knowledge easier to reach, understand, and use, and provides decision capability only when authoritative USER meaning, qualified criterion semantics, and sufficient V36-admitted evidence support that work. A consultation may end successfully in `KnowledgeOutcome`, `DecisionSupportOutcome`, or Action Preparation. `DecisionPlan`, Decision Engine, and `StructuredDecision` are conditional decision-path artifacts, never universal Product state.

The release still requires durable execution, cancellation, subject isolation, observability, recoverability, and faithful Solandra presentation. It does not require autonomous external action, a visible multi-agent UI, or every possible domain/file workflow. Older OD-001 language guaranteeing a decision for every consultation is superseded.

## 0.4 Canonical Lattice system registry and naming

**Confirmed Owner decision:** use one canonical name for each major Product or prototype system so architecture, handoffs, tests, and status reports do not collapse distinct authority boundaries. The detailed registry is maintained in `docs/design/Lattice-System-Registry-and-Naming.md`.

| Class | Canonical name | Short form | Owns |
|---|---|---|---|
| Umbrella Product | **Lattice Product** | **Lattice** | The complete user-facing Product and Product-owned architecture. |
| Product authority | **Lattice Intent Authority** | **Intent Authority** | Versioned structured user intent, intent deltas, clarification state, USER provenance, correction lineage, and exact `intentVersionId` binding. |
| Product runtime | **Lattice Execution Runtime** | **Execution Runtime** | Durable Run lifecycle, coordination, cancellation, recovery, public Run events, and research scheduling/execution. |
| Product boundary | **Lattice Model Gateway** | **Model Gateway** | Provider-neutral model requests, capability negotiation, bounded/cancellable invocation, and model-adapter isolation. |
| Product authority | **V36 Truth Core** | **V36** | External factual truth, evidence qualification/admission, provenance, contradiction, proof status, temporal applicability, and truth confidence. |
| Conditional Product authority | **Lattice Decision Engine** | **Decision Engine** | For qualified decision work only: requirement eligibility, typed comparisons, meaningful difference, frontier/tie/outcome semantics, and authoritative `StructuredDecision`. |
| Product experience | **Solandra Experience** | **Solandra** | Conversation UX, clarification/progress presentation, explanation, semantic projection, Knowledge Crystallization, evidence/uncertainty presentation, and continuation. |
| External development system | **V7 LLM Simulation Lab** | **V7 Simulation Lab** | Offline model/API simulation and qualification evidence about the simulator itself. |

Canonical conceptual paths:

```text
User conversation
      |
      v
Lattice Intent Authority
      | confirmed IntentVersion
      v
Lattice Execution Runtime
      | research / operational work and conversational work context
      v
V36 Truth Core
      |-- validated knowledge --------------------> KnowledgeOutcome
      |-- trustworthy state ----------------------> Action Preparation
      '-- qualified decision evidence projection -> Decision Engine -> DecisionSupportOutcome

All outcome classes -> Solandra Experience -> User
```

Only the decision branch has a `DecisionPlan`. Every Run binds one exact `IntentVersion`; ordinary conversational/work context may participate in the current Run without becoming authoritative intent or DecisionPlan meaning.

The Lattice Model Gateway is a non-authoritative capability boundary that may be invoked by Product systems where a qualified design permits model assistance. Model output remains proposal/rendering material until the owning Product authority accepts it under its own contract. During prototype development, the V7 LLM Simulation Lab may stand in for model/API behavior at that boundary; the lab never acquires Lattice Product authority merely through that use.

Use suffixes consistently: **Core** for protected semantic authority, **Authority** for canonical Product state in a bounded semantic domain, **Engine** for deterministic authoritative evaluation, **Runtime** for operational lifecycle/execution, **Gateway** for non-authoritative capability boundaries, **Experience** for human-facing presentation/interaction, and **Lab** for external development experimentation. `Specification`, `Handoff`, `Design`, and `Package` name artifacts, not runtime systems.

Avoid unqualified terms such as `conversation system`, `AI system`, `model system`, `truth layer`, `decision system`, `Solandra system`, or bare `V7` when they could be mistaken for another authority boundary.

# 1. Executive Design Position

Lattice should reach 1.0 by preserving the repaired Product boundaries rather than replacing them with a new distributed system. The authority direction is conversation/provenance -> authoritative intent -> bounded work -> V36 truth -> an outcome appropriate to the actual need -> faithful presentation. Decision machinery is entered only for qualified decision work. The primary 1.0 work is to make the surrounding Product, orchestration, provider, security, and operational layers production-capable.

## 1.1 Recommended architectural shape

**Recommended approach:** Remain a modular monolith in one codebase through 1.0, but run it as separate process roles: API, Run coordinator worker, Research worker, and migration/admin process. Use PostgreSQL as the authoritative durable state store and keep the transactional outbox + lease model as the queueing backbone. Do not introduce microservices or a separate message broker until measured scale, isolation, or operational requirements justify them.

Why: this preserves the repository’s existing CAS, transactional outbox, restart-safety, truth snapshot, and PostgreSQL validation investments while avoiding a second distributed consistency problem before the Product semantics are mature.

What would change the recommendation: sustained throughput that materially overloads PostgreSQL queue/outbox behavior; independent scaling/failure isolation that cannot be achieved with process roles; provider workers requiring a different runtime; multi-region active-active requirements; or a need to deploy the truth core under a separately governed security boundary.

## 1.2 Most important design changes before 1.0

1. Wire the Lattice Execution Runtime async durable path as the default PostgreSQL runtime, including one migration authority and real worker processes.
2. Connect durable research tasks to V36 Truth Core through a provider-neutral research-request contract without moving proof/admission semantics into orchestration.
3. Preserve Lattice Intent Authority interpretation and material clarification so conversation does not silently become canonical intent; create DecisionPlans only for qualified decision work.
4. Preserve typed Criterion Catalog and meaningful-difference/frontier Decision Engine semantics without raw cross-scale scoring or forced winners.
5. Add a persistent conversation/message model, progress delivery, authentication, user isolation, and correction-aware user preference continuity.
6. Promote one or more live providers only after the offline baseline is fixed and exact live-provider acceptance proves V36 semantics remain intact.
7. Evolve Solandra Experience from exact canonical text to richer communication while preserving a read-only, evidence/decision-bound fidelity contract.
8. Add production observability, security/privacy controls, performance budgets, migration/rollback discipline, and release readiness gates.

# 2. Product Outcome and 1.0 Scope

## 2.1 1.0 user outcome

A user should be able to start with ordinary language rather than a schema. Lattice should determine which missing information materially changes the work, research only what is needed, distinguish trustworthy evidence from unresolved or conflicting claims, and return trustworthy knowledge, conditional decision support, or a prepared non-consequential Resource. It must not manufacture decision work merely because a Run exists.

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
Lattice Execution Runtime / durable bounded research
  |
  v
V36 Truth Core
  |-- KnowledgeOutcome
  |-- Action Preparation
  '-- qualified decision only:
        DecisionPlan -> decision evidence projection
        -> Lattice Decision Engine -> DecisionSupportOutcome

All paths -> Solandra Experience
```

## 2.2 Proposed 1.0 must-have scope

| Capability | 1.0 position | Design intent |
|---|---|---|
| Natural-language intake | Required | User supplies goals and context conversationally; structured intent is derived internally by the Lattice Intent Authority boundary. |
| Material clarification | Required | Ask only when unresolved information can materially change options, architecture of the Run, or result. |
| Priority / constraint modeling | Required for decision capability | Explicit, versioned USER intent drives decision logic; inferred material intent is confirmable/correctable. Knowledge and non-decision Action Preparation do not require it. |
| Durable asynchronous Runs | Required | 202 acceptance, progress, cancellation, retry/recovery, and restart-safe completion through Lattice Execution Runtime. |
| Bounded live research | Required when the consultation needs external evidence | Provider-neutral research with budgets/deadlines; provider output remains untrusted candidate evidence. |
| V36 truth adjudication | Required / protected | Material external-world claims cross V36; generic truth execution does not require candidate-shaped decision inputs. |
| Trustworthy knowledge | Required | Knowledge Runs can complete successfully through V36 without a DecisionPlan, candidates, or Decision Engine. |
| Conditional decision support | Required capability | Qualified decision work uses an exact DecisionPlan, decision-specific evidence projection, typed comparisons, explicit uncertainty, and no forced winner. |
| Action Preparation | Required capability | Trustworthy Product state may produce a non-consequential Resource without requiring decision machinery. |
| Solandra explanation | Required | Conversation carries questions, clarification and concise explanation; Composer presents the most useful trustworthy visual material. Neither surface creates Product authority. |
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

# 3. Current Baseline at the Reconciled Revision

The following is the starting state for the 1.0 design. It is intentionally summarized here so this document can remain self-contained; deeper detail is in the repository-understanding baseline created from the same revision.

| Area | Current state | 1.0 implication |
|---|---|---|
| V36 Truth Core | Implemented offline with typed claims, proof contracts, provenance, adjudication, admission, snapshots, fidelity tests. | Preserve semantics; integrate live/durable research around it. |
| Lattice Execution Runtime / Run state | Run status/version CAS, durable truth/Run persistence, durable research orchestration, async API control, and separate Run/Research worker roles are implemented and composed. | Preserve resumability, idempotency, cancellation, and the boundary that runtime state cannot establish truth or decision meaning. |
| Research | Offline deterministic execution and durable provider-neutral research task DAG/attempt/outbox/continuation paths are implemented. | Qualify provider use without giving runtime or orchestration epistemic authority. |
| Lattice Model Gateway | Product-owned provider-neutral offline model boundary with deterministic fixture support, bounded/cancellable/idempotent runtime semantics, and loopback-only OpenAI-compatible qualification support. Current main also composes this boundary into a development-only transient simulated-conversation surface. | Reuse for intent/explanation/provider qualification while preserving the rule that model output is proposal/rendering material, not intent, truth, decision, or Product-validation authority. |
| V7 LLM Simulation Lab | Historical external prototype-stage artifact: `lattice-llm-simulation-lab` `1.7.0-research`; it remains standalone development evidence, not Lattice Product code or a current implementation target. | Retain only as optional provider-boundary qualification provenance; its outputs do not establish Product correctness or production readiness. |
| Historical Solandra offline-prototype design | Owner-approved bounded design provenance: `lattice-solandra-ui-design-package-offline-prototype-approved`. The current implemented Product surface is the Core-aligned Conversation + Composer design. | Preserve useful qualified provenance without treating the old offline prototype as the current implementation target or authority over current behavior. |
| Lattice Intent Authority | Durable/versioned structured intent authority, exact USER provenance, pending material inference, confirmation/correction lineage, and exact Run binding are implemented. | Preserve the boundary that conversation is context/provenance and only Intent Authority establishes canonical intent. |
| Lattice Decision Engine | Generalized qualified-criterion comparison, requirement eligibility, meaningful difference, material dominance, frontier/tie/unresolved/insufficient-evidence outcomes, and conditional execution are implemented. Legacy weighted fixture scoring is isolated from canonical runtime. | Extend only through qualified criterion semantics and V36-admitted evidence; never restore raw cross-scale scoring or a forced winner. |
| Solandra Experience | The current Conversation + Composer implementation presents authoritative Product state through a behavior-subordinate deterministic boundary with browser/mobile acceptance coverage. Development simulation surfaces are explicitly non-canonical. | Preserve adaptive trustworthy presentation without moving intent, truth, decision, or authorization authority into the UI. |
| Auth / durable conversation persistence | Authenticated-subject ownership, durable conversations/messages, continuity, preferences, deletion, and cross-subject isolation are implemented. | Preserve fail-closed ownership and privacy while completing only separately qualified 1.0 security/operations work. |
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

## 3.2 Historical Solandra offline-prototype UI design package

**Historical Owner approval:** the refined Solandra UI design was approved as the Product-design target for its bounded offline-prototype scope. It remains provenance for that completed design stage, not the current implementation target and not authority over the Core-aligned Conversation + Composer behavior now implemented.

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

Validation remains revision-bound: the historical package approval did not itself validate implementation. Current browser/mobile and Product acceptance evidence belongs only to the exact current implementation revision and does not retroactively promote the package into runtime authority.

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

**Current reconciliation:** Intent Authority versioning, provenance, clarification, correction, exact Run binding, and non-authoritative interpretation are implemented in the repaired architecture. Historical handoff artifacts remain provenance, not independent current authority or validation.

# 4. Architecture Principles and Authority Boundaries

## 4.1 Authority map

| Concern | Canonical owner at 1.0 | May not do |
|---|---|---|
| User intent | Lattice Intent Authority | Cannot rewrite user intent to match a preferred recommendation; cannot treat assistant/model text as USER authority without a qualified user-supported contract. |
| Operational lifecycle | Lattice Execution Runtime | Cannot establish external truth or decision semantics. |
| Research execution | Lattice Execution Runtime research components | Cannot admit evidence or set Lattice truth confidence. |
| Model invocation | Lattice Model Gateway | Cannot establish user intent, external truth, eligibility/ranking, winner state, or Product validation. |
| External factual truth | V36 Truth Core | Cannot adopt provider confidence or feature-specific shortcuts as truth. |
| Qualified decision support | Lattice Decision Engine | Cannot run without qualified decision semantics, strengthen V36 truth, treat unknown requirements as satisfied, sum incompatible raw scales, or force a winner. |
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
- Conversation is not intent; intent is not truth; truth is not decision; decision is not authorization. Decision machinery is conditional.
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
                 +------------------+------------------+
                 |                  |                  |
          KnowledgeOutcome   Action Preparation   qualified decision
                                                    projection only
                                                          |
                                                          v
                                              Lattice Decision Engine
                                                          |
                                                DecisionSupportOutcome

All outcomes are presented by Solandra Experience.
```

The V7 LLM Simulation Lab is outside this Product-authority diagram. It may exercise the Lattice Model Gateway in prototype development without becoming a Product runtime dependency or authority.

## 5.1 Module boundaries inside the codebase

Module/package names are implementation organization, not alternative system names.

| Module / package | Canonical system mapping | Responsibility | Dependencies |
|---|---|---|---|
| product/intent | Lattice Intent Authority | Conversation input, intent versions, clarification, user priorities/constraints. | Lattice Model Gateway when qualified; no V36 dependency unless validating an external-world claim. |
| product/planning | Lattice Intent Authority / conditional decision planning | Builds an exact DecisionPlan only from an authoritative IntentVersion whose decision work is qualified. | Intent state + qualified Criterion Catalog semantics; cannot create independent USER meaning. |
| runtime/run | Lattice Execution Runtime | Run lifecycle, CAS transitions, cancellation, phase coordination. | Stores + truth/decision interfaces; no provider SDKs. |
| runtime/orchestration | Lattice Execution Runtime | Research task DAG, leases, retries, outbox dispatch. | Run epoch + task definitions; no truth semantics. |
| model | Lattice Model Gateway | Provider-neutral model capability contracts/adapters and bounded runtime semantics. | Model providers/simulators; no Product authority. |
| truth/v36 | V36 Truth Core | Claim/provenance/proof/admission/adjudication/fidelity semantics. | Provider-neutral evidence/research result contracts only. |
| research | Lattice Execution Runtime research capability | Provider adapters, retrieval execution, artifact normalization, timeouts/budgets. | External providers; outputs untrusted candidate artifacts/evidence. |
| decision | Lattice Decision Engine | For qualified decision work: typed requirement eligibility, meaningful comparison, frontier/tie/uncertainty, and delegated selection only when licensed. | DecisionPlan + decision-specific projection of V36-admitted evidence. |
| presentation/solandra | Solandra Experience | Conversation for dialogue and concise explanation; adaptive Composer for trustworthy information/resources. | Read-only persisted intent/truth/conditional decision/resource state + Lattice Model Gateway where qualified. |
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
| StructuredDecision | PostgreSQL | Lattice Decision Engine through guarded Run store | Conditional, immutable authoritative decision state for Runs that performed qualified decision work. Absent otherwise. |
| KnowledgeOutcome / DecisionSupportOutcome / Resource | PostgreSQL | Owning Product boundary through guarded Run state | Outcome shape follows actual consultation need; no universal decision artifact. |
| Explanation | PostgreSQL | Solandra Experience through guarded completion | Derived from the applicable persisted authority; may be regenerated only under explicit versioned policy. |
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

## 7.1 Keep Product lifecycle conditional

```text
CREATED
-> UNDERSTANDING
-> AWAITING_CLARIFICATION -> UNDERSTANDING
-> INVESTIGATING
-> VALIDATING
-> COMPLETED

Qualified decision branch only:
UNDERSTANDING -> PLANNING -> INVESTIGATING -> VALIDATING -> DECIDING -> COMPLETED

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

**Implemented foundational contract:** exact USER provenance, immutable IntentVersion lineage, fail-closed material clarification, semantic equality, correction/supersession, and exact downstream Run binding. Conversation and current-Run work context remain non-authoritative unless Intent Authority accepts USER meaning.

## 8.2 Proposed intent pipeline

1. Persist the user message before model interpretation.
2. A non-authoritative interpreter may produce a schema-validated proposal: objective effect, correction, conditions/context, requirements, preferences, request-for-explanation, confirmation, ordinary conversational context, or material inferred meaning.
3. Product-owned Intent Authority policy compares proposals with user-supported state and classifies material explicit, inferred, or unresolved meaning.
4. If inferred/unresolved meaning can materially change the work, enter AWAITING_CLARIFICATION and ask the smallest useful question.
5. User correction creates a new IntentVersion under the qualified reducer/version contract. The new version becomes controlling for future work without rewriting historical versions.
6. Create a Run bound to the exact authoritative IntentVersion. Retain ordinary follow-up text as non-authoritative Run work context when useful.
7. Only when decision work is qualified, Planning creates a faithful DecisionPlan projection bound to that exact IntentVersion.

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

The plan is conditional decision state. It must project all execution-significant authoritative USER semantics and must not invent independent USER meaning. It may request evidence/research, but it does not decide whether returned evidence is true. Knowledge and non-decision Action Preparation Runs have no DecisionPlan.

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

# 11. Conditional Lattice Decision Engine capability

## 11.1 Entry condition

The Decision Engine is not part of every consultation. It runs only when Intent Authority says decision work is requested, a faithful DecisionPlan can be constructed from the exact IntentVersion and qualified Criterion Catalog semantics, and V36 can admit sufficient evidence into a decision-specific `DecisionInputSnapshot`. Keywords alone do not qualify decision work.

## 11.2 Proposed criterion model

```text
CriterionDefinition
  id
  label
  supported roles and typed comparison semantics
  valueType: NUMBER | BOOLEAN | CATEGORY | ORDINAL
  unit?
  direction?: HIGHER_BETTER | LOWER_BETTER | TARGET
  constraintPredicate?
  utilityFunction? // only when criterion semantics license normalization
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

## 11.3 Eligibility and comparison semantics

- Requirements are evaluated through typed `SATISFIED | FAILED | UNKNOWN` semantics; applicable failed requirements make a candidate ineligible.
- A FAIL is an established violation. UNKNOWN means Lattice could not establish the requirement; it is not silently rewritten as failure in the explanatory model even though it cannot satisfy eligibility.
- Criterion Catalog definitions own meaningful-difference and comparison semantics. Incompatible raw numeric scales are never summed as though commensurable.
- Preference coverage and uncertainty are represented independently from utility. Numeric utility is permitted only when the specific criterion licenses normalization/comparison.
- Material dominance yields a nondominated frontier. Ties and materially distinct frontier options remain visible; the Engine does not force a winner.
- Outcomes include `FRONTIER`, `TIE`, `UNRESOLVED`, `INSUFFICIENT_EVIDENCE`, and `NO_ELIGIBLE_CANDIDATE` where applicable.
- Delegated selection occurs only when exact USER authority licenses final selection from the valid frontier.

## 11.4 Proposed StructuredDecision evolution

```text
StructuredDecision
  runId
  intentVersionId
  planVersion
  goal
  outcome: RECOMMENDATION | FRONTIER | TIE | UNRESOLVED |
           INSUFFICIENT_EVIDENCE | NO_ELIGIBLE_CANDIDATE
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

1. Build an ExplanationContext exclusively from the applicable persisted authorities: IntentVersion, V36 truth state, optional StructuredDecision, optional Resource, and explicitly permitted non-authoritative work context/metadata.
2. Generate a structured ExplanationPlan appropriate to `KnowledgeOutcome`, `DecisionSupportOutcome`, or Action Preparation, including required uncertainty and evidence references.
3. A deterministic validator checks that every material claim in the plan is licensed by the authoritative state.
4. A model may render prose through Lattice Model Gateway from the validated plan.
5. Post-render validation ensures applicable outcome, uncertainty, evidence references, and conditional decision semantics are unchanged; failure blocks the prose or falls back to a deterministic renderer.

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
| POST /api/v1/conversations/:id/turns | Submit free-form USER turn / correction | Canonical intake; persists exact provenance, interprets against current IntentVersion, and may create a Run or clarification proposal. |
| POST /api/v1/conversations/:id/clarifications/:proposalId/confirm | Confirm one exact pending proposal | Explicit confirmation only; corrections/new meaning return through `/turns`. |
| GET /api/v1/runs/:id | Poll Run state | Existing concept retained. |
| GET /api/v1/runs/:id/events | Durable event history | Existing concept retained; paginated/cursor-ready. |
| GET /api/v1/runs/:id/events/stream | SSE progress | Reconnect with Last-Event-ID or equivalent sequence cursor. |
| POST /api/v1/runs/:id/cancel | Cancel active Run | Existing CAS semantics retained. |
| GET /api/v1/runs/:id/outcome | Read the polymorphic Product outcome | Returns Knowledge, Decision Support, or Action Preparation from completed authoritative state; active Runs return current status. |

## 13.3 Error model

API errors should use stable machine-readable codes plus safe human messages. Internal provider/DB details remain in correlated logs. Important categories: validation, ownership/not-found, idempotency conflict, clarification required, terminal-state conflict, rate/budget limit, temporary dependency failure, and internal failure.

# 14. Persistence and Data Architecture

## 14.1 PostgreSQL remains the authoritative store through 1.0

Recommendation: retain PostgreSQL for conversations, Runs, tasks, outbox, idempotency, truth entities/snapshots, conditional decisions, resources, explanations, and operational metadata. Avoid introducing a second durable database until data shape or scale proves it necessary.

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
| Solandra rendering fails | Retry/fallback renderer; persisted Product authority remains intact. A failed presentation cannot rewrite the underlying outcome. |
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

Lattice Execution Runtime owns operational lifecycle state; Solandra Experience presents only useful, licensed progress appropriate to current work. It must not impose a fixed user-facing phase sequence: planning and deciding appear only on qualified decision paths, while Knowledge or Action Preparation may proceed without them. Progress should not expose provider chain-of-thought, raw prompts, secrets, internal stack traces, or implementation-only task states.

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
| Unit | Pure intent, truth, conditional decision, resource, serialization, and validation semantics. |
| Contract | Lattice Model Gateway/provider-neutral adapters, API DTOs, store interfaces, migration readiness, explanation licensing. |
| Integration | PostgreSQL transactions/CAS/outbox/tasks, Lattice Execution Runtime coordination, cancellation, restart/recovery. |
| Deterministic Product acceptance | Same canonical API proves Knowledge, qualified Decision Support, and Action Preparation; decision cases additionally prove V36-to-Decision Engine fidelity and no forced winner. |
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
| G6 — Conditional Lattice Decision Engine | Decision capability proves qualified Criterion Catalog semantics, requirement eligibility, meaningful difference, frontier/tie/insufficient-evidence behavior, no raw cross-scale dominance, and no forced winner. Knowledge and non-decision Action Runs prove the Engine and DecisionPlan are absent. |
| G7 — Solandra Experience | Conversation + Composer remain subordinate to Product behavior; presentation cannot change authoritative intent/truth/conditional decision/resource state or introduce unsupported material claims. |
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
| Build to 1.0 | M5 — Lattice Intent Authority + conditional planning | Accept normal-language goals and persist versioned authoritative USER intent. | Clear requests proceed; material ambiguity awaits clarification; corrections preserve history; every Run binds exact intent; only qualified decision work receives a faithful DecisionPlan. |
| Build to 1.0 | M6 — Conditional Lattice Decision Engine | Preserve typed criteria, tri-state requirements, meaningful difference, material dominance, frontier/tie/uncertainty, and licensed delegation. | Cross-scale tests pass; no forced winner; Knowledge and non-decision Action paths bypass decision machinery. |
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

M5 Lattice Intent Authority -----> M10 Solandra Experience 1.0 explanation
              |
              '-- qualified decision capability -> M6 Lattice Decision Engine

M7 Conversation/progress + M8 Auth/privacy
----------------------------------------> M11 Production operations

All paths --------------------------------------------> M12 1.0 stabilization
```

# 24. Risks, Unknowns, and What Could Change the Design

| Risk / unknown | Impact | Mitigation / design response |
|---|---|---|
| Product work drifts back to mandatory decision machinery | Knowledge and Action Preparation become artificial decision problems. | Apply the Core first; require three-path acceptance and absence tests for DecisionPlan/Decision Engine. |
| Durable research handshake contaminates V36 semantics | Highest architectural risk. | V36 emits/consumes research contracts; Lattice Execution Runtime never decides proof/admission; qualify any truth-state change. |
| Lattice Intent Authority over-accepts model interpretation | Could silently mutate controlling USER intent. | Preserve the implemented Product-owned transition/reducer/provenance semantics; model output remains proposal; fail closed on material ambiguity. |
| Generic Lattice Decision Engine becomes another hidden expert system | Could produce misleading rankings across domains. | Typed criteria + explicit utility/domain adapters + sensitivity/unknown reporting. |
| Provider variability causes nondeterministic acceptance drift | Could weaken trust core. | Permanent offline mode, V7 Simulation Lab, live-provider acceptance corpus, provenance normalization, bounded policy. |
| PostgreSQL outbox becomes a bottleneck | May limit throughput or cause lock contention. | Measure first; index/partition/batch/worker tuning. Introduce broker only with evidence. |
| Model-generated Solandra explanation adds unsupported facts | Could bypass decision authority. | Structured ExplanationPlan, deterministic licensing, post-render validation, fallback renderer. |
| Memory leaks stale external facts into future Runs | Could bypass same-Run truth. | Separate person-owned preference memory from factual evidence; require V36 for factual reuse. |
| Auth/privacy work arrives late | Can force schema/API rewrites. | Add subject ownership to core Product entities before public/live 1.0 data accumulation. |
| Operational SLO/cost targets are unknown | Architecture may be over/under-built. | Bind OD-009 before production scale decisions. |
| File ingestion added to 1.0 late | Expands parser security, storage, provenance, privacy scope. | Resolve OD-010 early or defer explicitly. |

# 25. Open Decisions and Proposed ADR Register

## 25.1 Decision status

| ID | Decision | Why it matters | Needed by |
|---|---|---|---|
| OD-001 | **RESOLVED / SUPERSEDED BY CORE RECONCILIATION:** 1.0 is trustworthy knowledge plus conditional decision capability, not a mandatory StructuredDecision journey. | Controls release gates and prevents decision machinery from becoming universal. | Current |
| OD-002 | **RESOLVED:** protected V36 immutable checkpoint/research handshake. | Keeps operational work from acquiring epistemic authority. | M4 |
| OD-003 | **RESOLVED:** qualified Criterion Catalog, typed comparison, meaningful difference, material-dominance frontier, and licensed delegation. | Prevents raw-scale scoring and forced winners. | M6 |
| OD-004 | **RESOLVED:** Product-owned immutable/versioned Intent Authority with provenance, clarification, correction, exact Run binding, and conditional DecisionPlan. | Protects canonical USER intent and downstream fidelity. | M5/M7 |
| OD-005 | Select first qualified model/research provider(s) and provider-routing policy. | Controls live integration surface, cost, latency, and evaluation. | M9 |
| OD-006 | Define the generalized Solandra Experience explanation licensing/fidelity contract. | Allows rich prose without losing intent/truth/decision authority. | M10 |
| OD-007 | **RESOLVED:** explicit preference continuity, not generalized conversational memory. | Controls continuity/privacy and stale-fact risk. | M8 |
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
| 0.9 | 2026-09-03 | 3de31612c46a3e31a70e6977f6e100d20bb6be85 | Reconciles the Living Design to the Core and repaired Product architecture: trustworthy knowledge plus conditional decision capability; three outcome paths; conditional DecisionPlan/Decision Engine; adaptive Conversation + Composer presentation; current Intent/V36/decision boundaries; and explicit non-canonical legacy/development composition. |
| 0.10 | 2026-09-03 | 3de31612c46a3e31a70e6977f6e100d20bb6be85 | Reconciles the current baseline with implemented Intent Authority, generalized conditional decision semantics, current Conversation + Composer behavior, durable runtime/auth boundaries, and one canonical polymorphic `/outcome` surface; retains old prototype packages and decision-only `/result` behavior as historical or explicit legacy scope only. |

# 27. Proposed 1.0 Definition of Done

Under the confirmed Core-aligned definition of 1.0, the release is not complete merely because the API is deployed or a live provider returns answers. The exact candidate revision must satisfy all of the following observable outcomes:

- A new authenticated user can create a conversation and state a knowledge, decision, or Action Preparation need in ordinary language.
- Lattice Intent Authority preserves explicit USER intent and version/correction history; ordinary conversation remains provenance/context; material inferred meaning awaits clarification.
- Lattice Execution Runtime durably accepts a Run with idempotent semantics and the Run can be polled, streamed, cancelled, restarted, and safely redelivered.
- Research is bounded, durable, provider-neutral, and produces untrusted artifacts/results that cannot bypass V36 Truth Core.
- V36 protected semantics pass the full offline suite and the qualified live-provider acceptance suite.
- Knowledge completes through V36 without a DecisionPlan, Decision Engine, or candidate-shaped generic truth interface.
- Qualified decisions alone receive an exact faithful DecisionPlan and decision evidence projection; the Decision Engine does not mix incomparable raw scales or force a winner and explicitly represents frontier/tie/unresolved/insufficient-evidence states.
- Action Preparation can produce a non-consequential Resource without a DecisionPlan when no decision was required.
- Applicable authoritative state is persisted before human-readable explanation; StructuredDecision is required only when the consultation actually performed qualified decision work.
- Solandra Conversation communicates questions, clarifications, acknowledgements, and concise explanations; Composer presents adaptive trustworthy material without changing Product authority or duplicating the transcript as status chrome.
- Conversation history, confirmed preferences, corrections, Runs, decisions, and results survive supported restart and remain subject-isolated.
- Security/privacy controls, rate/budget controls, observability, backup/restore, graceful shutdown, migration readiness, load targets, and rollback procedures have reproducible acceptance evidence.
- Known limitations are documented and explicitly accepted rather than hidden behind a “1.0” label.

# Appendix A. Repository Source Basis for the Baseline

| Area | Primary sources |
|---|---|
| Product / architecture | docs/design/The-Core-Lattice-Philosophy.md first; then conforming living/domain architectures, docs/specifications/SPEC-1-Lattice-Rebuilt/, and protected V36 contracts. |
| Runtime / API | src/runtime-app.ts and src/http-app.ts (canonical); src/legacy/ and src/development/ (explicit non-canonical compositions); src/index.ts; src/runtime-config.ts; stores/control adapters. |
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
6. Preserve and extend the implemented Intent Authority transition/persistence/provenance contract without promoting conversation into intent.
7. Preserve typed criteria and conditional Decision Engine semantics before enabling additional decision domains.
8. Add authenticated subject ownership and progress streaming before accumulating real multi-user live-provider data.
9. Promote the first live provider only through a separate exact-revision acceptance Work Item.
10. Generalize Solandra explanation from the applicable outcome authority; require StructuredDecision fidelity only on the decision path.

**Design baseline conclusion:** The path to Lattice 1.0 is not a rewrite. It is a controlled expansion of the repaired boundaries: keep Intent Authority person-centered and versioned, Execution Runtime durable, research untrusted, V36 epistemically authoritative, Decision Engine conditional and semantically qualified, and Solandra useful without allowing UI, prose, providers, examples, or simulation labs to become alternate Product authority.
