# SPEC-1 — Lattice Truth-Core Prototype Architecture

## 34. Truth-Core Revision Authority

The V36 Truth Engine is the epistemic core of the Lattice prototype.

Every material assertion about the external world that can materially affect an authoritative Lattice decision MUST pass through the V36 truth boundary before it can be treated as established factual evidence.

V36 does not own all Product state. User intent, explicit preferences, priorities, authentication state, operational metadata, scheduling state, budgets, deadlines, and other non-epistemic Product state remain outside the truth engine unless they themselves become material external-world claims requiring verification.

The architectural rule is therefore not “everything goes inside V36.” It is:

**Everything factual that materially influences authoritative Product reasoning goes through V36.**

## 34.1 Protected-core contract

“Protected core” refers to V36's qualified epistemic contracts, invariants, observable behavior, persisted truth semantics, and acceptance requirements.

It does not permanently freeze current filenames, module boundaries, function names, algorithms, or internal implementation techniques.

Internal V36 implementation MAY be refactored when the protected behavior remains equivalent and exact-revision acceptance establishes that equivalence.

Outer Product features MAY depend on stable truth-core contracts.

The truth core MUST NOT acquire semantic dependencies on UI behavior, provider SDK behavior, memory features, domain-specific presentation, explanation wording, or other outer Product features merely to make those features easier to implement.

Refactoring the implementation is permitted. Weakening the epistemic contract is not.

## 34.2 Core contamination rule

An outer feature MUST NOT:

- directly admit evidence;
- write authoritative truth state outside the constrained truth persistence boundary;
- weaken proof obligations for feature convenience;
- convert unresolved evidence into established evidence;
- treat rejected evidence as useful factual support;
- allow repeated copies of one source to create artificial corroboration;
- map provider confidence directly to Lattice truth confidence;
- convert `UNVERIFIED` into `FALSE`;
- erase or suppress a verified contradiction;
- convert `MIXED` into uncontested truth;
- use temporally invalid evidence as current fact;
- bypass same-Run evidence requirements;
- make ranking or preference score override truth state;
- make explanation override truth state;
- introduce feature-specific alternate definitions of factual validity.

A feature that requires any of these behaviors is architecturally invalid.

## 34.3 Truth-core revision protocol

V36 is the protected prototype baseline.

A modification to the truth core is permitted only as an explicitly identified **Truth-Core Work Item**.

A Truth-Core Work Item MUST bind:

- the qualified requirement motivating the change;
- the exact starting truth-core revision;
- the affected invariant, proof obligation, admission rule, provenance rule, verdict semantic, or fidelity contract;
- expected Product benefit;
- acceptance criteria;
- adversarial regression requirements;
- preserved behaviors;
- exact-revision validation requirements;
- migration or compatibility implications when applicable.

A truth-semantic change MUST NOT be hidden inside provider integration, UI work, memory implementation, file support, domain expansion, performance optimization, refactoring, infrastructure work, or another nominal feature.

If feature development discovers that V36 itself is insufficient, the feature reaches a boundary. The suspected deficiency becomes a separate Truth-Core Work Item and is evaluated on its own evidence.

No feature has authority to weaken the core merely because doing so would make that feature easier to complete.

# 35. V36 Truth Model

The canonical material claim types are:

- `FACTUAL`
- `CAUSAL`
- `QUANTITATIVE`
- `CURRENT_STATE`
- `INTERPRETIVE`
- `AUTHENTICITY`
- `OPINION`

These supersede the earlier generic `FACT / DERIVED / ASSESSMENT` taxonomy for V36 truth adjudication.

Material verdicts are:

- `TRUE`
- `FALSE`
- `MISLEADING`
- `UNVERIFIED`
- `OUTDATED`
- `OPINION`
- `MIXED`

Atomic evidence disposition remains separately representable as:

- `SUPPORTED`
- `REFUTED`
- `INSUFFICIENT`
- `CONFLICT`

Truth confidence remains distinct from provider confidence, model confidence, decision confidence, ranking stability, and evidence coverage. No automatic numerical mapping between those concepts is permitted.

## 35.1 Typed proof obligations

The machine-readable V36 claim-proof contract remains the exact controlling obligation contract for the prototype.

### FACTUAL

- `FACTUAL_CORE`
- `SCOPE_CONTEXT`
- `SOURCE_PROVENANCE`
- `CONTRADICTION_SEARCH`

### CAUSAL

- `FACTUAL_CORE`
- `CAUSAL_SUPPORT`
- `ALTERNATIVE_EXPLANATIONS`
- `SCOPE_CONTEXT`
- `INDEPENDENT_CORROBORATION`
- `CONTRADICTION_SEARCH`

### QUANTITATIVE

- `SOURCE_VALUE`
- `UNIT`
- `DENOMINATOR`
- `BASELINE`
- `TIME_PERIOD`
- `INDEPENDENT_RECOMPUTATION`
- `SOURCE_PROVENANCE`

### CURRENT_STATE

- `FACTUAL_CORE`
- `CURRENT_AUTHORITATIVE_SOURCE`
- `TEMPORAL_APPLICABILITY`
- `HISTORICAL_CURRENT_COMPARISON`
- `CONTRADICTION_SEARCH`

### INTERPRETIVE

- `LITERAL_FACT`
- `SURROUNDING_CONTEXT`
- `SCOPE_CONTEXT`
- `INTERPRETATION_SEPARATION`
- `CONTRADICTION_SEARCH`

### AUTHENTICITY

- `ORIGIN`
- `IDENTITY`
- `CONTENT_INTEGRITY`
- `CONTEXT`
- `INDEPENDENT_CORROBORATION`

### OPINION

- `FACT_CHECKABILITY`

Outer Product functionality cannot replace these contracts with generic confidence or provider-specific scoring.

# 36. Truth-Core Invariants

The prototype MUST preserve these invariants:

1. Persisted structured evidence state is authoritative; generated prose is downstream.
2. Material assertions are typed before proof obligations are evaluated.
3. Proof obligations are deterministic by claim type.
4. Source count, model agreement, and repeated rediscovery do not establish independence.
5. Original or upstream primary artifacts are preferred when practical.
6. Provenance components, source derivation edges, artifact hashes, relevant similarity, evidence-effective dates, and research-question lineage remain representable.
7. Retrieval date, publication date, and evidence-effective date are distinct.
8. Unsupported positive claims become `UNVERIFIED`, not automatically `FALSE`.
9. CAUSAL and AUTHENTICITY positives require materially independent corroboration; other sufficiently high-risk positives may require it under the active V36 contract.
10. Verified supporting and contradictory evidence remains conflict; positive burden cannot erase contradiction.
11. Important positive claims receive a disconfirming route when required by V36 policy.
12. A blocking contradiction must itself be applicable, traceable, and sufficiently verified.
13. Research is bounded; exhaustion produces uncertainty rather than weakened proof.
14. Parallelism is not evidence.
15. Rejected evidence is inert for constraints, factual requirements, scoring, and positive factual explanation.
16. Material decision evidence remains same-Run unless a separately qualified reusable-evidence contract is introduced.
17. Uncertainty is valid Product state.
18. Decision logic cannot strengthen or reinterpret truth state.
19. Explanation cannot alter persisted truth or decision state.
20. Simulation calibration values are implementation seeds, not externally validated production epistemic constants.

# 37. Evidence, Provenance, and Research Boundary

External content begins as untrusted data.

The architecture MUST support representing, where applicable:

- canonical source location;
- artifact identity and content hash;
- publisher and originating source;
- provenance component and confidence;
- authoritative-primary status;
- retrieval, publication, and evidence-effective timestamps;
- source derivation relationships;
- relevant content similarity;
- research-question lineage;
- relation to a claim;
- evidence verification;
- admission result;
- rejection reason.

Relevant source relationships include `CITES`, `DERIVES_FROM`, `SYNDICATES`, `COPIES`, and `MIRRORS`.

Evidence relationships include `SUPPORTS`, `CONTRADICTS`, `CONTEXT`, and `NEUTRAL`.

Research supplies candidate evidence to V36. It does not perform final truth admission.

Research purposes include `PRIMARY_SOURCE`, `SUPPORT`, `DISCONFIRM`, `INDEPENDENT_CORROBORATION`, `TEMPORAL_REFRESH`, and `CONTRADICTION_VERIFY`.

Independent research operations MAY execute concurrently, but concurrency MUST NOT alter claim type, proof obligations, provenance independence, evidence admission, or verdict semantics.

Missing required corroboration MAY trigger bounded second-origin recovery. Exhaustion without sufficient proof remains explicit uncertainty.

# 38. Decision Evidence Eligibility

Under the current V36 prototype contract, positive factual decision evidence MUST resolve to same-Run evidence admitted by a material `TRUE` truth assessment.

`UNVERIFIED`, `MIXED`, `OUTDATED`, `MISLEADING`, `FALSE`, rejected, unresolved, or otherwise non-qualifying evidence MUST NOT masquerade as positive factual support.

Non-`TRUE` truth assessments MAY still be material Product state. They may explain uncertainty, conflict, staleness, failed eligibility, or why Lattice cannot establish a proposition.

They MUST NOT be converted into positive factual decision evidence merely because downstream scoring or feature logic would benefit from doing so.

If a future qualified truth-core revision intentionally changes the positive-evidence eligibility contract, it must provide an equally explicit admission boundary and corresponding acceptance evidence.

Hard constraints operate only on qualifying truth evidence. Missing evidence is not automatically favorable evidence. Preference scoring cannot make an ineligible candidate eligible and cannot override a failed hard constraint.

Decision confidence and ranking stability remain separate from factual truth confidence.

# 39. Offline-Only Prototype Stage

The initial complete Lattice prototype is offline.

Canonical truth mode:

```text
LATTICE_TRUTH_MODE=v36-offline
```

The offline prototype MAY use deterministic evidence fixtures, deterministic research providers, fixed adversarial corpora, local calculations, development PostgreSQL, local processes, provider-neutral simulations, fault injection, and deterministic replay.

Offline Product acceptance MUST NOT require OpenAI, Anthropic, live web search, paid research services, provider credentials, provider-hosted state, or live external research.

Provider-neutral interfaces MAY exist before live integrations. A dormant live-provider path MUST fail closed when invoked during the offline stage.

The purpose of the offline stage is to isolate and prove Lattice's own Product semantics before introducing provider variability.

# 40. Architecture Around the Core

The prototype is organized conceptually around V36:

```text
User / Product input
        ↓
Durable orchestration and bounded research
        ↓
Untrusted evidence candidates
        ↓
V36 TRUTH ENGINE
        ↓
Persisted authoritative truth state
        ↓
Structured Decision
        ↓
Persisted decision
        ↓
Faithful explanation / presentation
```

The User/Product layer owns user messages, goals, priorities, constraints, clarification, progress, and result presentation. It does not determine external truth.

The Orchestration layer owns durable Run lifecycle, plans, tasks, retries, deadlines, budgets, cancellation, research dispatch, task ownership, and concurrency. It supplies evidence candidates to V36.

The V36 Truth Engine owns claim construction and typing, provenance, proof obligations, verification, admission, positive burden, contradiction handling, falsification, corroboration, quantitative proof, temporal applicability, material verdicts, truth confidence, and authoritative truth persistence semantics.

The Structured Decision layer owns hard-constraint evaluation using admitted truth, candidate eligibility, preference weighting, ranking, bounded uncertainty treatment, sensitivity, and the authoritative StructuredDecision.

The Explanation layer owns faithful human-readable representation. It consumes persisted truth and decision state as read-only authority.

# 41. Outer Feature Integration Rule

Every new feature must answer:

> How does this capability compose around the protected V36 truth core without modifying or bypassing its semantics?

Memory may provide user preferences, goals, constraints, project context, and prior decisions. Memory is not automatically evidence about the external world.

Uploaded documents are untrusted source material. File-derived factual claims enter the same provenance, proof, verification, admission, and decision pipeline.

Models may interpret intent, propose plans, extract claims, suggest research, analyze candidate evidence, perform bounded qualitative assessment, or generate explanations. Model output does not bypass V36.

Research providers return source/evidence candidates. They do not return authoritative Lattice truth, and provider confidence MUST NOT directly set Lattice truth confidence.

Specialist identity does not confer factual authority.

Domain extensions MAY add stricter qualified proof requirements or specialized research strategies. They MUST NOT weaken baseline V36 obligations.

The UI MAY progressively expose complexity but MUST NOT hide blocking uncertainty by falsely presenting a definitive result.

# 42. Core-Contamination Acceptance Gate

Offline prototype acceptance MUST include architectural probes demonstrating that outer Product capabilities cannot silently bypass or redefine V36.

Acceptance must establish, where applicable:

- authoritative truth cannot be written through an outer feature path;
- decision evidence cannot bypass V36 admission;
- provider confidence cannot directly become truth confidence;
- source count cannot directly become corroboration;
- memory cannot become external-world evidence without truth evaluation;
- uploaded-file assertions cannot bypass claim/provenance/proof processing;
- UI or explanation logic cannot mutate authoritative truth;
- preference scoring cannot override failed truth requirements;
- domain-specific features cannot silently lower V36 proof burdens;
- dormant live-provider execution remains fail-closed during the offline stage.

A feature fails architecture acceptance if it works functionally but introduces an epistemic bypass.

# 43. Offline Acceptance Program

Offline acceptance is a Product gate, not merely successful compilation.

The exact candidate revision MUST demonstrate:

### Truth semantics

- deterministic proof contracts for every active V36 claim type;
- unsupported positive → `UNVERIFIED`;
- required causal/authenticity independent corroboration;
- applicable high-risk positive corroboration;
- conflict → `MIXED`;
- stale current-state evidence → `OUTDATED`;
- material context omission → `MISLEADING`;
- opinion remains `OPINION`;
- quantitative unit/denominator/baseline/period integrity;
- rejected evidence cannot influence positive decision eligibility or scoring.

### Provenance

- copied, syndicated, or mirrored reports do not create false independence;
- citation laundering is handled by available provenance structure;
- original-source recovery works where required by the fixed corpus;
- unresolved provenance confidence remains explicit;
- same-Run provenance is enforced.

### Adversarial investigation

- required disconfirming research;
- contradiction verification;
- bounded corroboration recovery;
- bounded exhaustion;
- parallel execution cannot change proof semantics;
- fixed V36 adversarial-corpus acceptance.

### Determinism

Equivalent deterministic inputs on the same truth-core revision produce equivalent authoritative structured results.

### Durability

Where applicable, truth state, decision state, and Run identity survive supported restart; stale epochs cannot create accepted side effects; partial truth insertion rolls back; accepted state remains reconstructible from persisted provenance.

### Decision and explanation fidelity

Only qualifying truth may satisfy positive factual decision requirements. A candidate violating an established hard constraint cannot win. Explanation cannot alter winner, constraints, truth, or add unsupported material factual claims. Fidelity failure blocks successful completion.

### Core contamination

The probes in section 42 pass.

# 44. Exact-Revision Validation

Acceptance applies only to the exact Product revision exercised.

Required repository gates include:

```bash
npm ci --no-audit --no-fund
npm run build
npm test
npm run check
```

When PostgreSQL changes are present, the applicable development PostgreSQL validation lane MUST pass against the exact candidate revision.

Passing repository gates is insufficient while an applicable V36 Product acceptance criterion is failing.

Previous revision validation does not automatically transfer to a later revision.

# 45. Accepted Offline Baseline

Successful offline acceptance MUST produce an identifiable baseline containing at minimum:

- exact Product source revision;
- exact V36 contract revision;
- machine-readable proof-contract version;
- adversarial corpus version;
- relevant migration/schema state;
- validation configuration;
- executed acceptance evidence;
- documented known limitations.

This becomes the reference state against which the first live-provider integration is compared.

Later code that merely resembles the baseline is not assumed equivalent. Live integration must demonstrate that the transition preserves the protected truth-core behavior on the exact candidate state.

# 46. Offline-to-Live Transition

Passing the complete offline acceptance program makes Lattice **Product-eligible for a separately qualified live-provider testing Work Item**.

Offline acceptance does not itself authorize live execution.

The initial live Work Item must preserve V36 as the authoritative truth engine and treat the provider as an evidence-acquisition mechanism.

The purpose of initial live testing is to test whether real-world evidence can pass through the already accepted architecture, not to allow providers to redefine that architecture.

Live-provider findings fall into two primary categories:

1. **Provider/acquisition deficiency:** the provider retrieved, normalized, attributed, or structured evidence poorly. Repair belongs outside the truth core when possible.
2. **Truth-core deficiency:** correctly represented real-world evidence exposes a defect or missing epistemic capability in V36. Repair requires a separately qualified Truth-Core Work Item.

Neither category authorizes an ad hoc weakening of the acceptance contract.

Product eligibility for live testing remains separate from authorization for paid providers, production deployment, production data mutation, secrets, billing, security ownership changes, or other protected external actions.

# 47. Prototype Build Sequence

The revised build sequence is:

1. Preserve and baseline current V36 contracts.
2. Preserve the V36 acceptance/adversarial suite.
3. Maintain deterministic offline evidence acquisition.
4. Complete durable truth persistence and integrity.
5. Complete bounded offline research orchestration.
6. Complete StructuredDecision consumption of admitted truth.
7. Complete decision persistence.
8. Complete explanation fidelity.
9. Complete the offline Run/API lifecycle.
10. Complete restart, failure, stale-epoch, and transactional recovery.
11. Complete end-to-end offline Product acceptance.
12. Record the accepted exact offline baseline.
13. Qualify one live-provider integration Work Item.
14. Introduce one provider-neutral live research implementation when authorized.
15. Execute bounded live evaluation.
16. Diagnose provider-boundary versus truth-core failures.
17. Revise the core only through an explicit qualified Truth-Core Work Item when Product evidence warrants it.
18. Expand live capabilities only while protected-core acceptance remains satisfied.

Feature breadth is secondary to proving the truth-centered Product architecture.

# 48. Truth-Core Milestones

## P1 — Protected Truth Core

Deliver V36 claims, proof contracts, provenance, evidence verification/admission, adjudication, positive burden, falsification, corroboration, and temporal/quantitative semantics.

Exit: truth-domain and adversarial gates pass.

## P2 — Durable Truth State

Deliver Run-scoped persistence, transactional truth insertion, same-Run integrity, recovery/replay, and migration validation.

Exit: truth state survives supported restart and partial truth transitions roll back safely.

## P3 — Decision Around Truth

Deliver factual hard constraints, eligibility, bounded scoring, StructuredDecision, and evidence lineage.

Exit: non-qualifying evidence cannot produce a factual decision advantage.

## P4 — Faithful Solandra

Deliver persisted decision, explanation generation, and fidelity validation.

Exit: generated language cannot alter or exceed structured authority.

## P5 — Complete Offline Product Path

Deliver the complete path:

```text
user request
→ durable Run
→ offline research
→ V36
→ persisted truth
→ decision
→ persisted decision
→ explanation
→ result
```

Exit: the Product path functions without live research/provider credentials.

## P6 — Offline Acceptance Baseline

Deliver deterministic replay, adversarial corpus, provenance testing, failure/recovery testing, transaction testing, core-contamination testing, and exact-revision evidence.

Exit: no known mandatory offline acceptance criterion is failing.

## P7 — Live Research Integration

Deliver one provider-neutral live adapter, source normalization, provenance preservation, and bounded external execution under a qualified Work Item.

Exit: live evidence reaches V36 without bypassing or modifying the core contract.

## P8 — Live Truth Evaluation

Deliver controlled real-world evaluation, error taxonomy, offline/live comparison, cost/latency observations, and identified provider/core deficiencies.

Exit: evidence exists to decide the next live Product-development phase.

Production deployment is not implied by P8.

# 49. Prototype Non-Goals Before Offline Acceptance

Before the offline acceptance baseline is established, avoid broad implementation of:

- production deployment;
- production data mutation;
- broad multi-provider routing;
- provider optimization;
- paid intelligence infrastructure;
- broad persistent memory;
- broad file workflows;
- autonomous agent ecosystems;
- generic specialist proliferation;
- large UI feature surfaces;
- infrastructure unrelated to offline acceptance;
- premature calibration of simulation coefficients as production truth constants.

Interfaces required to keep future additions clean MAY be established earlier.

# 50. Final Architectural Law

**The V36 Truth Engine is the core of the Lattice prototype.**

Lattice exists around that core.

Upstream systems acquire, organize, and submit candidate information.

V36 determines what that information is epistemically permitted to become.

Downstream systems make decisions and communicate results from the structured state V36 authorizes.

User intent and Product control state need not live inside V36, but material external-world factual assertions that affect authoritative decisions cannot route around it.

Providers are evidence suppliers.

Models are reasoning tools.

Research systems are acquisition mechanisms.

Memory is context.

Files are untrusted inputs.

Scoring is preference evaluation.

Solandra is the authoritative decision and communication layer.

None of them independently defines external truth.

The prototype begins offline so that this architecture can be deterministically reproduced, attacked, repaired, and accepted without live-provider variability.

Only after a complete offline baseline has been accepted does Lattice become Product-eligible for a qualified live-provider testing phase.

Live testing then asks whether real-world evidence can successfully enter the architecture while V36 retains the guarantees proven offline.

Lattice may gain new providers, interfaces, domains, memory, files, specialists, tools, and capabilities.

The core may itself improve through explicit, evidence-backed Truth-Core revisions.

What Lattice must never permit is **silent epistemic degradation caused by feature development**.

**Build outward from V36.**

**Route material factual authority through V36.**

**Change V36 only deliberately.**

**Never weaken the truth core merely to make another feature work.**
