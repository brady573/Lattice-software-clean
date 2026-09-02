# M9 — Live-Provider Promotion Architecture

Status: **IMPLEMENTATION-READY DRAFT / OD-005 PARTIALLY BLOCKING PROMOTION**

Date: **2026-08-30**

Reconciliation baseline: `main @ 47f41e5feba263200a0d9a01a4c2eb1015da4736`, tree `fd18de8da0de60f30eb72176fc224b8fa07389e5`.

Scope: architecture/review only. This document does not authorize live-provider activation, paid infrastructure, production deployment, production data mutation, production secrets, provider-routing policy, or M9 runtime implementation. OD-005 remains unresolved unless separately decided by the Owner.

## 1. Objective and authority chain

M9 promotes Lattice from deterministic/local model execution toward bounded live-provider execution without changing the Product authority chain:

```text
USER
  -> Lattice Intent Authority
  -> DecisionPlan / Run
  -> Lattice Execution Runtime
  -> bounded model / tool / research operations
  -> V36 Truth Core
  -> Lattice Decision Engine
  -> Solandra Experience
```

A model, provider, broker, proxy, router, or tool runner is an execution capability inside this chain. None is a Product authority layer.

The architecture is constrained by the Owner-approved Foundational Design Principle, Architecture Integrity controls, the canonical living design and amendments, the confirmed OD-002 V36 continuation contract, the confirmed OD-004 Intent Authority contract, the accepted M8 subject/privacy/continuity architecture and implementation, and the current canonical source.

The earlier contents of this file were an Owner-directed proposed design. They are supporting design provenance, not independent requirement authority. This revision reconciles those proposals against current canonical `main` and current provider/broker realities.

## 2. Current architecture findings

Canonical source already provides most M9 structural seams:

- **Lattice Model Gateway** is provider-neutral and non-authoritative.
- `ModelProvider` exposes one narrow asynchronous generation boundary.
- canonical requests already support bounded messages, tool definitions, output-token bounds, correlation identity, idempotency keys, attempts, cancellation, and normalized model responses.
- `OpenAiCompatibleModelProvider` already normalizes text and structured tool-call output, rejects malformed tool arguments, bounds response bytes, recognizes cancellation, and maps 429/5xx failures into normalized provider errors.
- `ModelRuntime` already owns bounded per-invocation timeout, attempt count, canonical validation, same-process duplicate suppression, and sanitized audit metadata.
- durable Run and Research worker machinery already owns at-least-once operational execution, leases, retry scheduling, stale-epoch handling, immutable research results, and process-restart recovery.
- the M4 V36 bridge already binds full immutable V36 checkpoints to durable research tasks and keeps operational failure distinct from epistemic judgment.
- M8 already supplies authenticated subject ownership, Conversation-derived graph isolation, subject-scoped idempotency, explicit preference continuity, historical immutability, and deletion-state enforcement.
- the local-model benchmark already supplies provider-independent deterministic scenarios for structured action/tool calling, tool-result round trips, prompt-injection handling, provenance selection, repeated pass rate, latency, and exact model/runtime provenance.

Therefore M9 must **extend existing seams rather than create a parallel inference, research, retry, or orchestration stack**.

### Important current gaps

1. The current OpenAI-compatible adapter intentionally accepts only loopback URLs and labels itself `openai-compatible-local`; loopback transport is not enough to prove offline/local execution because a loopback process may broker remote requests.
2. Current model audit metadata does not define a Product-owned normalized distinction between requested route and actual routed provider/model.
3. `ModelRuntime` duplicate suppression is process-memory scoped. Durable semantic idempotency across worker/API restart must remain owned by the durable Execution Runtime/task identity layer rather than being inferred from this in-memory helper.
4. Canonical tool definitions exist, but there is not yet a separately justified Product subsystem whose only purpose is to execute arbitrary model tools.
5. Provider-side retention/training, rate/quota, route substitution, and cost characteristics are external qualification facts, not Product truth or routing authority.

## 3. Review of the existing M9 direction

| Existing concept | Disposition | Reconciled conclusion |
|---|---|---|
| `LOCAL_OFFLINE` | **RETAIN, REVISE DEFINITION** | Retain as an execution/trust class, but qualify it by verified no-external-egress execution conditions, not URL location alone. |
| `LIVE_BROKERED` | **RETAIN** | Correct stable Product classification for a local/nearby broker that can send requests externally. Broker identity remains adapter/provenance detail. |
| `LIVE_DIRECT` | **RETAIN / DEFER IMPLEMENTATION** | Useful stable classification, but no direct external adapter is required merely to complete the first brokered M9 slice. |
| broker-neutral OpenAI-compatible integration | **RETAIN** | Best current compatibility seam. Product contracts must stay canonical and broker-neutral. |
| FreeLLMAPI as first broker | **REVISE / DEFER TO QUALIFICATION** | Useful zero-cost development candidate, not the normative first route. Its automatic routing/failover and changing catalog make it a strong stress surface but weak Product policy authority. Any use must be pinned or provenance-verifiable for provider-specific claims. |
| normalized route/provider provenance | **RETAIN / EXPAND** | Must distinguish requested execution policy, requested provider/model, actual provider/model, broker, route mode, and provenance completeness. |
| Product-owned Tool-Use Controller | **REPLACE AS A NEW SUBSYSTEM** | Do not introduce a parallel controller by default. Put capability validation and execution authorization at the existing Execution Runtime/Research-task boundary, with a narrow reusable `ToolExecutionPolicy`/capability contract if implementation needs one. |
| Execution Runtime / Research Worker executes bounded tools | **RETAIN / NARROW** | Correct owner for operational execution, retry/recovery, budgets and immutable results. Research Worker should execute only already-authorized research capabilities. |
| V36 admission after operational execution | **RETAIN** | Required. Operational success remains candidate evidence only. |
| pinned provider/model qualification | **RETAIN** | Required before claiming a specific provider/model role passed. |
| routing/failover qualification | **RETAIN / BLOCK PROMOTION ON OD-005** | Can be simulated before OD-005. Product promotion of automatic fallback/routing requires OD-005. |
| M9-A through M9-F decomposition | **REPLACE** | Current sequence mixes standalone model qualification with Product contract work and delays the highest-value architectural uncertainty. Revised sequence below reduces uncertainty earlier and reuses existing durable execution. |

## 4. Provider execution abstraction

### 4.1 Stable Product contract

M9 should preserve `ModelProvider` as the transport/provider adapter seam and add a Product-owned invocation envelope around it rather than provider-specific methods.

Conceptually:

```text
ModelInvocationRequest
  runBinding
  subjectBinding
  role
  executionPolicy
  canonicalModelRequest
  contextProjectionDescriptor
  capabilityGrant
  budget

ModelInvocationResult
  canonicalModelResponse
  invocationProvenance
  normalizedUsage
  operationalOutcome
```

The exact TypeScript shape is an implementation detail for a later Work Item. The architectural requirement is that Product execution policy and normalized provenance exist outside provider-specific metadata.

### 4.2 Execution classes

`LOCAL_OFFLINE`
- execution is locally controlled;
- the qualified test environment prohibits external provider/model egress for the invocation path;
- a loopback URL is compatible with this class but does not prove it.

`LIVE_BROKERED`
- Lattice invokes a broker/proxy/gateway that may select or contact external providers;
- the Lattice-to-broker hop may itself be loopback;
- provider credentials may be held by the broker, but never become authoritative Product state.

`LIVE_DIRECT`
- Lattice invokes an external provider endpoint through a provider adapter;
- reserved until a qualified role actually needs direct integration.

Execution class is a trust/data-boundary declaration. It does not imply model quality or truth authority.

### 4.3 Role qualification

Provider/model qualification should be role-based and capability-based rather than globally declaring a model "approved".

Example role requirements may include:
- structured response support;
- tool-call proposal support;
- context size sufficient for the bounded projection;
- deterministic-enough behavior for the assigned task;
- timeout/latency envelope;
- malformed-output rate;
- provider privacy/retention characteristics;
- cost class;
- route provenance completeness.

A provider/model qualified for one role is not thereby qualified for research, intent interpretation, decision support, or another role.

### 4.4 Requested versus actual route

Every live invocation must be able to represent at least:

```text
executionClass
routeMode: PINNED | PRODUCT_ROUTED | BROKER_AUTOMATIC
requestedProvider?
requestedModel
actualProvider?
actualModel?
brokerIdentity?
brokerVersion?
upstreamRequestId?
routeProvenance: COMPLETE | PARTIAL | MISSING
```

Provider/broker-specific raw metadata may be retained in bounded operational diagnostics where safe, but Product layers consume normalized fields only.

If a test claims that provider/model X was exercised, `actualProvider` and `actualModel` must be established strongly enough for that claim. Missing or ambiguous route provenance does not make the request epistemically false; it makes the provider-specific validation claim invalid.

### 4.5 Routing and failover

Before OD-005:
- engineering may test explicitly selected/pinned routes;
- deterministic fixtures may simulate automatic routing/failover;
- a broker's automatic route may be observed as research evidence;
- automatic routing must not become Product policy or silently alter a Run's meaning.

After OD-005, Product-owned routing may select among **qualified role-compatible routes** only. A fallback must preserve the same Run, subject, semantic operation, context projection policy, capability grant, truth standard, and provenance contract.

A fallback that changes any of those is a new semantic operation and must not be hidden as an ordinary retry.

## 5. Failure semantics

Provider operations are external side effects in the operational sense even when they do not mutate Lattice Product truth. Recovery therefore distinguishes **transport retry** from **semantic re-execution**.

| Failure | Owner / behavior |
|---|---|
| unavailable before dispatch | Execution Runtime does not create a successful result; retry only under bound task policy. |
| timeout after provider may have processed request | Treat completion as ambiguous. Never infer non-execution. Reuse the same durable operation identity; only retry when the role/provider contract allows duplicate-safe re-dispatch. |
| duplicate delivery / worker restart | Existing durable task fingerprint, attempt, lease and immutable-result machinery owns deduplication/recovery. Do not add a second provider orchestration ledger. |
| API/research-worker/broker restart | Durable Run/research state remains canonical; adapter connections are reconstructable operational dependencies. |
| 429 | normalized rate-limit failure; respect bounded retry/backoff policy; availability does not authorize fallback. |
| provider 5xx/outage | normalized unavailable failure; fallback only if qualified/licensed. |
| malformed response | fail closed as provider output failure; do not coerce prose into structured authority. |
| malformed tool proposal | reject before execution; it is neither a tool result nor truth evidence. |
| unavailable tool | return bounded operational failure when the model interaction contract allows it; never substitute an undeclared capability. |
| partial tool execution | persist actual operational outcome/provenance. If the capability is not idempotent, do not repeat it blindly. |
| stale Run epoch / superseded IntentVersion | existing exact Run/task binding wins; discard/stale the work and do not attach output to the successor. |
| subject/deletion state changes | recheck authorization/deletion at the last safe Product-owned boundary before external dispatch and before exposing/persisting user-facing results where applicable. No new dispatch after access is invalid. |
| fallback provider/model | preserve semantic contract and record both attempted and successful routes; otherwise surface failure rather than silently changing meaning. |
| missing actual-route provenance | result may remain operationally usable only for claims that do not depend on provider identity; provider-specific qualification fails closed. |
| lost external network access | operational failure only; V36 determines whether the absence of evidence leaves truth unresolved. |

## 6. Tool-use architecture: reuse Execution Runtime

The proposed `Tool-Use Controller` should **not** be introduced as a new top-level subsystem unless implementation proves a distinct lifecycle/state owner is needed.

Current architecture already has the correct operational owner: **Lattice Execution Runtime**, with Research Worker as the durable execution role for V36-requested research work.

The smallest architecture is:

```text
model emits tool-call proposal
  -> Model Gateway canonical normalization
  -> Execution Runtime validates proposal against exact capability grant
  -> authorized capability executor performs bounded operation
  -> immutable operational result + provenance
  -> optional bounded tool result returned to model
  -> if factual/research-bearing: V36 continuation/admission
```

A narrow shared policy object/module may be implemented for capability validation, but it must remain subordinate to Execution Runtime rather than becoming an authority tier.

### Required capability contract

Each executable capability must bind:
- stable capability ID/version;
- Product-owned argument schema;
- exact Run and subject binding;
- allowed purpose/role;
- call-count budget;
- timeout budget;
- input/output byte bounds;
- network/egress allowlist where applicable;
- cancellation behavior;
- idempotency class and operation identity;
- result normalization/provenance contract;
- secret exposure policy.

Models may propose only capabilities included in the exact invocation grant. No model receives generalized shell, filesystem, database, GitHub, production-secret, arbitrary-network, or autonomous-action authority.

### Research Worker interaction

Research Worker continues to execute already-authorized durable research tasks. It must not decide:
- whether evidence is sufficient;
- whether a claim is true;
- whether to broaden research scope outside the V36 checkpoint/request;
- whether a provider/tool has authority to act beyond its capability grant.

Those existing boundaries should be extended, not replaced.

## 7. V36 and live information

The required live-information path is:

```text
provider/model proposal
  -> Product-owned bounded operation
  -> immutable operational result + provenance
  -> V36 resume/continuation
  -> V36 admission / rejection / unresolved / further research
  -> authoritative truth snapshot
```

Operational facts such as HTTP success, provider confidence, repeated model agreement, provider reputation, route selection, benchmark score, or broker success never increase truth authority by themselves.

The current M4 architecture is sufficient for this path. M9 should add executors/adapters and provenance to the existing research-task result boundary rather than creating a second research system.

## 8. Privacy and continuity through M8

M8 completion supplies ownership and continuity foundations but does not authorize indiscriminate external context export.

Every live invocation must build a **minimum-necessary context projection** for its exact role and Run. The projection is derived from authoritative Product state and is not itself a new mutable memory system.

Possible inputs, only when required:
- the current USER turn;
- exact `IntentScopeId + IntentVersionId` meaning relevant to the operation;
- exact DecisionPlan/Run identifiers and bounded task description;
- explicit USER preference values that were already copied into the authoritative IntentVersion or separately licensed for the request;
- prior operational results needed for the current bounded step;
- V36 research request/checkpoint-derived query material appropriate for the executor.

Do not automatically export:
- full Conversation history;
- unrelated historical turns;
- account-wide saved preference inventory;
- prior external facts as current truth;
- hidden provider/broker metadata;
- secrets or internal credentials.

### Product persistence versus provider retention

Lattice persistence remains governed by Product ownership/deletion/retention rules. Provider-side retention/training is a separate external processing property.

Provider privacy characteristics should be classified as:

1. **Architecture invariant** — Lattice must know enough about the selected route's data handling to enforce the qualified data-class policy; provider policy may not silently override Product intent/privacy boundaries.
2. **Provider-qualification evidence** — current retention, training, jurisdiction, enterprise/privacy controls, and logging behavior for the exact provider/route used in testing.
3. **Future production-policy decision** — which external data classes may be processed under which provider terms in production. M9 architecture does not invent this policy.

## 9. Configuration, secrets, cost and network boundaries

Provider credentials, broker keys, and secret material remain operational configuration, not authoritative Product state.

Requirements:
- no credentials in IntentVersion, DecisionPlan, Run semantic state, V36 truth, Decision Engine state, Conversation content, or Solandra presentation;
- logs/audit records identify credential slots/configuration classes, not secret values;
- adapters receive secrets only at the operational boundary that requires them;
- absence/invalidity of a secret is an operational configuration failure;
- development profiles explicitly declare `LOCAL_OFFLINE`, `LIVE_BROKERED`, or `LIVE_DIRECT`; loopback is not an automatic classifier;
- zero-cost/free-tier status is qualification evidence captured with date/source and may expire;
- any paid-provider activation remains Owner-only.

## 10. External broker/provider reconnaissance

Current external evidence supports a broker-neutral architecture rather than a FreeLLMAPI-specific Product design.

As of the reconciliation date:
- FreeLLMAPI presents itself as an OpenAI-compatible proxy aggregating many free-provider routes, with smart routing, automatic failover, encrypted keys, and a changing model catalog. That makes it useful for development comparison and failure/provenance testing, but its own router must not become Lattice Product policy.
- OpenRouter exposes free models/providers and automatic routing, while provider data practices differ by route. Broker-level convenience therefore cannot substitute for route qualification.
- Groq documents free-plan rate limits and standard 429 behavior; free availability is still quota-bound and model-specific rather than a stable Product guarantee.

These are research observations, not Product requirements. Provider availability, pricing, model catalog, terms, privacy practices, and API behavior must be freshly re-qualified when used as material evidence.

## 11. OD-005 boundary and decision packet

OD-005 remains unresolved: **select first qualified model/research provider(s) and provider-routing policy**.

### What can proceed before OD-005

M9 may design and implement/test, in later separately authorized Work Items:
- execution-class and normalized provenance contracts;
- provider-independent adapter contract tests;
- deterministic local simulation and malformed-provider fixtures;
- minimum-necessary context projection enforcement;
- capability-grant/tool-proposal rejection behavior;
- explicit pinned provider/model qualification experiments under zero-cost authorization;
- V36 integration using deterministic executors and a pinned external route;
- retry/restart/provenance-loss tests that do not promote automatic routing policy.

### What cannot be promoted before OD-005

M9 may not promote:
- automatic Product provider selection;
- automatic fallback between providers/models as normal Product behavior;
- a broker's own auto-router as the Lattice routing policy;
- a production provider set;
- provider-role assignments whose Product semantics depend on unresolved routing/data policy.

### Compact Owner decision packet

**Decision 1 — first promoted live execution policy**

Choose the initial Product policy for M9 acceptance:
1. **Pinned single route per qualified role** — one explicitly qualified provider/model route; failure surfaces rather than automatic provider fallback.
2. **Product-owned qualified fallback set** — a pinned primary plus explicitly qualified fallback route(s), preserving identical role/data/capability semantics.
3. **Broker-automatic routing** — delegate route selection to a broker within Product constraints.

**Recommended default: Option 1.** It minimizes authority ambiguity, improves reproducibility/provenance, and leaves fallback reversible for a later bounded Work Item. Option 2 is a reasonable later extension. Option 3 is difficult to validate as deterministic Product policy and should not be the first promoted behavior.

**Decision 2 — role scope of the first live route**

Choose whether the first promoted route is limited to:
1. **bounded research/model-assistance operations only**, with all factual material still entering V36; or
2. multiple model roles in the same milestone.

**Recommended default: Option 1.** It aligns directly with the M9 living-design exit criterion, minimizes data exposure and semantic coupling, and leaves broader role promotion reversible.

These are Product-policy decisions. Exact adapter classes, schema types, retry code structure, or broker library choice remain engineering decisions and should not be sent to the Owner.

## 12. Revised M9 Work Item decomposition

The previous A-F sequence is replaced by the following bounded sequence, optimized for uncertainty reduction and reuse.

### M9-1 — Invocation classification and provenance contract

Objective: introduce the Product-owned execution-class/route-provenance contract without external activation.

Prerequisite: current Model Gateway/adapter tests green on the exact candidate.

Surface: model invocation types/runtime audit/configuration and deterministic adapter fixtures only.

Invariants: loopback != offline; provider metadata remains non-authoritative; requested/actual route distinct.

Required probes: local-offline, brokered-loopback fixture, missing provenance, malformed metadata, route substitution, secret-redaction tests.

Exit evidence: deterministic contract tests prove classification/provenance semantics.

Owner input: **not required**.

### M9-2 — Capability proposal/execution policy on existing Runtime

Objective: enforce model tool proposals through existing Product-owned execution authority without creating a parallel controller subsystem.

Prerequisite: M9-1 contract.

Surface: canonical tool proposal normalization plus a narrow Execution Runtime capability-grant boundary; deterministic fake capability executors first.

Invariants: proposal != authority; schema/budget/egress/subject/Run binding fail closed; no generalized action capability.

Required probes: undeclared tool, malformed args, over-budget call, cancellation, stale Run, superseded intent/run, subject/deletion change, idempotent duplicate, non-idempotent ambiguous completion.

Exit evidence: deterministic Product-owned execution tests; no external provider required.

Owner input: **not required**.

### M9-3 — Context projection and privacy enforcement

Objective: prove minimum-necessary external context construction over accepted M8 state.

Prerequisite: M9-1; may run in parallel with M9-2 if code boundaries remain independent.

Surface: invocation context projection from Conversation/current USER turn/IntentVersion/Run/preferences/research state.

Invariants: subject isolation; no silent full-history export; no account-preference dump; historical external facts not promoted; secrets excluded.

Required probes: two-subject adversarial cases, deleted Conversation, revoked preference, historical-turn exclusion, exact IntentVersion binding, redaction/secret fixtures.

Exit evidence: provider-independent privacy/subject tests.

Owner input: **not required**.

### M9-4 — Pinned zero-cost provider qualification

Objective: qualify one explicitly selected zero-cost live provider/model route for the bounded first role.

Prerequisite: M9-1 and relevant M9-3 privacy safeguards. M9-2 if the role requires tool proposals.

Surface: brokered or direct adapter plus existing benchmark/contract harness; no Product routing promotion.

Invariants: actual route provenance; role-specific qualification only; benchmark success != Product acceptance.

Required probes: structured output/tool behavior as applicable, repeated pass rate, malformed response, timeout, 429, 5xx/unavailable simulation, quota/rate observations, retention/training evidence capture, cancellation.

Exit evidence: exact provider/model/route/date/revision qualification record.

Owner input: **not required for a zero-cost bounded development experiment**; paid activation remains prohibited.

### M9-5 — Live research through durable Runtime and V36

Objective: demonstrate the real live-information path using the existing durable research handshake.

Prerequisite: M9-2/3/4.

Surface: a narrowly allowlisted research capability/executor, Research Worker immutable result persistence, V36 continuation/admission.

Invariants: operational success is not admission; restart/retry does not duplicate semantic work; stale Run cannot consume result; V36 alone changes truth state.

Required probes: Golden, provider outage, worker restart, broker restart where applicable, duplicate dispatch, partial/failed operation, provenance loss, V36 admit/reject/unresolved/further-round behavior.

Exit evidence: exact-revision Product-observable live research trace.

Owner input: **not required** if the selected route is still a bounded zero-cost development route and does not establish routing policy.

### M9-6 — OD-005 routing promotion and resilience

Objective: implement only the routing/fallback behavior explicitly selected by OD-005.

Prerequisite: Owner resolves the relevant OD-005 policy; M9-4/5 evidence available.

Surface: Product-owned routing selection among qualified role-compatible routes, if the Owner selects more than pinned-single-route behavior.

Invariants: no semantic/data/truth change on fallback; complete route provenance; broker auto-routing cannot escape Product policy.

Required probes: pinned-primary failure, fallback eligibility, disallowed fallback, provider 429/5xx, missing route identity, different capability sets, context/retention incompatibility.

Exit evidence: exact-revision qualified routing contract, or explicit evidence that pinned-single-route failure semantics are the selected policy.

Owner input: **required before this Work Item can promote routing policy**.

### M9-7 — Integrated M9 acceptance

Objective: prove the complete promoted M9 Product behavior on one exact candidate revision.

Prerequisite: all required prior Work Items, including OD-005-dependent behavior selected for M9.

Surface: USER -> Intent Authority -> DecisionPlan/Run -> Execution Runtime -> qualified live operation -> V36 -> Decision Engine -> Solandra.

Required probes:
- Golden journey;
- Recovery journey with restart/retry;
- Adversarial malformed/provider-authority journey;
- subject/privacy isolation;
- route provenance and provenance-loss failure;
- Architecture Integrity acceptance.

Exit evidence: one exact revision with reproducible Product-observable acceptance and provenance.

Owner input: no additional design input unless the evidence exposes a new Product-policy decision.

## 13. Validation architecture

Validation should proceed cheapest and most discriminating first:

1. deterministic local fixtures/simulation;
2. provider-independent ModelProvider/invocation contract tests;
3. route normalization and provenance-loss tests;
4. adversarial malformed output/provider-authority tests;
5. tool proposal/rejection/capability-budget tests;
6. durable idempotency/retry/restart tests using current Runtime stores/workers;
7. V36 admission/non-admission tests with deterministic operational results;
8. M8 subject/privacy/context-projection adversarial tests;
9. pinned live-provider qualification;
10. live durable research/V36 integration;
11. routing/failover tests only after OD-005 licenses the behavior being promoted;
12. integrated Golden / Recovery / Adversarial Product journeys;
13. exact-revision acceptance plus Architecture Integrity acceptance.

External quota must not be repeatedly spent diagnosing failures reproducible with fixtures/local simulation.

## 14. M9 acceptance model

`M9 — COMPLETE` is legitimate only when one exact candidate revision demonstrates all M9 Product requirements actually selected for the milestone:

- at least one qualified live provider/model route performs its bounded Product role;
- execution class and requested/actual route provenance are correct and fail closed where claims require identity;
- provider/model output remains non-authoritative;
- model tool proposals cannot execute outside exact Product-owned capability grants;
- subject isolation and minimum-necessary context projection survive live use;
- durable retry/restart behavior preserves one semantic operation and exact Run binding;
- live operational results enter V36 through the existing durable continuation boundary;
- provider output cannot bypass V36 for material factual truth;
- Decision Engine consumes only the exact licensed authoritative state;
- Solandra presents accepted Product state without acquiring intent/truth/decision authority;
- OD-005-selected routing behavior, if any, passes exact-revision resilience tests;
- integrated Golden, Recovery, and Adversarial journeys pass;
- Architecture Integrity acceptance passes.

This is distinct from:
- **provider/model capability qualification** — standalone role evidence;
- **adapter/broker integration validation** — normalization/transport evidence;
- **tool-use validation** — bounded capability execution evidence;
- **V36 integration validation** — truth-boundary evidence;
- **routing/failover qualification** — route-policy evidence;
- **production readiness** — M11+ operational/security/cost/deployment evidence.

M9 completion does not authorize production deployment, production credentials, paid services, or production data processing.

## 15. Roadmap reconciliation

The derived `docs/ROADMAP.md` M9 row should be reconciled from the earlier M9-A..M9-F wording to the reviewed sequence above.

Recommended derived status:

**ARCHITECTURE REVIEWED / IMPLEMENTATION NOT STARTED / OD-005 PARTIALLY BLOCKING PROMOTION**

Recommended summary:

> Current-main architecture review confirms M9 should reuse the existing Model Gateway, durable Execution Runtime/Research Worker, M4 V36 continuation boundary, M8 isolation/continuity controls, and local qualification harness. The implementation sequence is M9-1 invocation classification/provenance; M9-2 Product-owned capability proposal/execution policy on the existing Runtime; M9-3 minimum-necessary context/privacy enforcement; M9-4 pinned zero-cost provider qualification; M9-5 live durable research through V36; M9-6 only the OD-005-selected routing/failover policy; and M9-7 exact-revision integrated acceptance. FreeLLMAPI is a replaceable `LIVE_BROKERED` development candidate, not routing authority or a production dependency. OD-005 does not block deterministic contract/privacy/tool/V36 architecture work or pinned zero-cost qualification, but it blocks promotion of automatic Product routing/failover policy.

Do not mark M9 underway merely because this architecture exists. Implementation begins only in a later bounded Product Development Work Item.

## 16. Risks and deferred questions

- Exact provider retention/training/terms are volatile external qualification facts and must be refreshed at use time.
- Free-provider quotas and catalogs are volatile; zero-cost status is not a Product guarantee.
- Some brokers may not expose reliable actual-provider/model identity. Such routes may be unsuitable for provider-specific acceptance claims.
- Provider tool-call schemas differ. Canonical Lattice schemas must remain the compatibility source, with adapter-specific loss of capability surfaced explicitly.
- Timeout after possible provider processing creates completion ambiguity; later implementation must classify operation idempotency rather than treating every provider call as safely retryable.
- Production data-class/provider policy, credentials, SLOs, paid activation, and deployment remain outside M9 architecture authorization.

## 17. Anti-drift audit

This architecture intentionally does not:
- transfer USER intent authority to a model/provider/broker;
- transfer operational execution authority out of Lattice Execution Runtime;
- create a parallel durable research/retry system;
- transfer V36 admission/sufficiency/truth authority;
- transfer Decision Engine authority;
- transfer Product state derivation to Solandra;
- classify loopback as offline without execution-boundary evidence;
- promote broker automatic routing into Product policy;
- treat benchmark success as Product acceptance;
- authorize paid providers, production secrets, production deployment, or production data use;
- claim future implementation is validated by current architecture evidence.

## 18. Exit state

This document is an **IMPLEMENTATION-READY DRAFT** for M9-1 through M9-5 and M9-7 acceptance design. M9-6 remains **BLOCKED BY OD-005** until the Owner selects the Product routing policy required for promotion.

A later implementation run must rebind fresh canonical source, current procedures, qualified requirements, and the first bounded M9 Work Item. This architecture is an input to that run; it is not implementation authorization.
