# Core Realignment Roadmap: every piece of code looked at against Trustworthy Intelligence for Action

Status: DRAFT roadmap only. No code changes authorized by this document.
Authority: `docs/design/The-Core-Lattice-Philosophy.md` (Owner-adopted 2026-09-28) — highest durable Product authority — as reconciled by Design Partner amendment DP-007 (branch NOT APPROVED FOR MERGE AS-IS; reconciliation + re-review required). This document stays working guidance, never Product authority.
Base inventoried: `origin/main` @ `c9bd1770cfa6eb2948f4a1957b6647565ff75199` (reconciled 2026-09-30 on `governance/realignment-roadmap`; prior stamp `f7652ff09d6b55b8571845a571c592f4d16e6f59` dated 2026-09-28, see §3 delta note).

## 1. Authority & non-goals

| # | Statement |
|---|-----------|
| A1 | The adopted Core (`docs/design/The-Core-Lattice-Philosophy.md`, **Trustworthy Intelligence for Action**) is the highest durable Product authority. Every area below is audited against it: Question → Understanding → Confidence → Action, the north-star triple (*What do we know? How do we know it? What can we responsibly do because of it?*), the 21 design principles (§47), and the anti-goals (§46). |
| A2 | All concrete examples in the Core (scenarios, numbers, sample phrasings, metric sketches) are ILLUSTRATIVE and NON-NORMATIVE. They must never become implementation rules, test fixtures, or acceptance thresholds. Principle governs on conflict. |
| A3 | No architecture replacement without explicit Owner authority. Slices that would require a new major subsystem/service or replacement of otherwise sound architecture STOP under CA-05 and escalate — they do not proceed as implementation. |
| A4 | OD-001-to-OD-004 is **CLOSED per DP-007**: the governed stage sequence is Question → Understanding → Confidence → Action, with legacy mechanics nested beneath those four stages. Presentation and continuation are explicitly **not** stages. OD-002–OD-004 keep their bounded authority semantics; they are not converted into stages. No slice proceeds on any remapped reading beyond this closed mapping. |
| A5 | This roadmap invents zero Product requirements. Anything that looks like a missing requirement is recorded as an Owner question in the slice's stop conditions. |
| A6 | Normative Core sections cited per phase use the adopted Core's numbering (§5, §9–§21, §31–§48). If the Core is amended, section references must be re-validated before use. |

**Non-goals:** merge/deploy/production changes; new CI lanes; benchmark campaigns; prompt-engineering tooling; exposing internal machinery (workers, providers, proof, routing, V36 vocabulary) to the user; re-auditing seeded findings F1–F8 (carried forward as-is except DP-007 scope updates to F4/F8 and the main-merged resolutions noted in §2).

## 2. Seeded findings (carry forward, do not re-audit)

Slice-1 status: **PAUSED by Owner.** Nothing below re-opens slice-1 scope. Note: wording-calibration slice merged on main (`feb8e82` / `46fc15c`, covering F1–F3 surfaces: short-turn non-authority marking, calibrated confidence language, absent-basis surfacing); slices audit the merged behavior as-is on resume.

| ID | Finding | Kind |
|----|---------|------|
| F1 | Short-turn non-authority marking (top) — short-turn outputs must be marked non-authoritative at the top | Trust-surface gap |
| F2 | Raw confidence labels — uncalibrated confidence labels reach the user | Language-calibration gap |
| F3 | Bare supported claims + trustworthy self-labels — claims presented as supported without shown basis; system self-labels as trustworthy | Trust-surface gap |
| F4 | Action Engine — **SCOPED per DP-007 / READY FOR IMPLEMENTATION PLANNING** (no building authorized by this document). Approved contract: modes INVESTIGATE / TEST / ACT / WAIT / ESCALATE; consequence-sensitive behavior; boundary constraints including v1 recommends-only. F4 is authorized as the Product subsystem defined by its scoped contract. Acceptance criteria: a meaningful next move can be derived from governed evidence rather than appended generically; unresolved material assumptions can weaken or change that move; consequence and reversibility materially affect recommendations; lack of sufficient evidence can result in investigate/wait/escalate rather than forced action; the user receives a simple next step rather than internal Action Engine machinery; execution authority is never silently inferred | Scoped architecture (was: architecture gate) |
| F5 | Composer-frame — RESOLVED in evolved form on main (#161 `c5714dd`): long ordinary answers render in the Composer inside a tentative, non-authoritative frame via explicit Solandra placement decision (supersedes parked `ada22fa` framing) | Resolved on main; slices audit the merged behavior as-is |
| F6 | Assumption Guard — REQUIRED Confidence-stage machinery, IMPLEMENTED on main in ephemeral turn-scoped form (#164 `0973c54`, DP-002/DP-004: deterministic gate before advisory conclusion finalization; materiality classification; WEAKEN + WEAKEN_AND_ASK; no persistence/migration). Retained as-is; this roadmap does not re-scope it | Implemented Confidence machinery (was: architecture-gate absence) |
| F7 | Unknown-roadmaps — unknowns have no governed roadmap (ask/research/test/verify routing per §42 loop missing) | Design gap; Owner questions expected |
| F8 | Trust-outcome telemetry — **SCOPED per DP-007 (DP-009)**: behavioral telemetry with governed initial event families: material_assumption_detected, material_assumption_resolved, material_assumption_user_clarified; claim_blocked_unsupported, claim_weakened_after_verification, claim_revised_after_new_evidence, contradiction_detected; clarification_requested, clarification_changed_outcome, clarification_unnecessary; action_proposed, action_mode_selected, action_verification_defined; action_outcome_observed, action_succeeded, action_failed, action_produced_new_evidence; user_correction_received. Explicit non-goals: no trust score, no AI credibility score, no user-belief score, no displayed confidence percentage derived from telemetry, no engagement metric treated as evidence of correctness. F8 is authorized as a telemetry contract whose instrumentation is sequenced behind stable F4/F6 behavior | Measurement scope (was: measurement gap); no new CI lane without Owner approval |

## 3. Coverage backbone: full code-surface inventory (read-only; inspected 2026-09-28 at `f7652ff`, reconciled 2026-09-30 to `c9bd177`)

Base: `c9bd177`. Counts are file counts from direct listing.

**Reconciliation delta `f7652ff`→`c9bd177` (9 commits):** wording-calibration slice (`46fc15c`, F1–F3 surfaces); harness assertions bound to presentation constants (#160); Composer placement merged in evolved form (#161); per-subject intake rate limiting (#163); ephemeral Assumption Guard gate (#164); `GET /api/version` (#165); agent-chain source-integrity repair (#166); Ubuntu CI runner pins (#167). Net new files: `src/assumption/` (4), `src/build-info.ts`, `src/ratelimit/subject-limiter.ts`, 6 new test files — reflected in the counts below; all other delta files are modifications of already-inventoried paths.

### 3.1 `src/` subdirectories (21 dirs, 144 files)

| Dir | Files | One-line responsibility (from direct inspection) |
|-----|------|--------------------------------------------------|
| `src/action-preparation/` | 1 | Prepared-resource (draft/checklist/message) store with Solandra draft authority marked non-factual, non-user-authored |
| `src/assumption/` | 4 | Ephemeral turn-scoped Assumption Guard gate (Confidence stage; #164 on main — guard/hook/index/types, no persistence) |
| `src/auth/` | 3 | Authenticated-subject identity normalization; single-owner token gate; neutral session-proof endpoint (no capability semantics) |
| `src/capabilities/` | 3 | Capability contracts (cognitive-only, non-authoritative effects), broker with authorization guards, grant/invocation evidence store |
| `src/conversation/` | 11 | Conversation CRUD API + membership guard, reference store/backfill/upgrade, governed reference admission, response store, run-index control |
| `src/decision/` | 12 | Structured-decision schema/validation, generalized decision engine over admitted evidence, criterion catalog, snapshots, A3 alpha capability composition + run worker |
| `src/development/` | 3 | Development-only runtime/prototype app entrypoints (gated to `development` deployment mode) |
| `src/intent/` | 22 | Intent authority core: types/reducer/version lineage, consultation interpreter, decision-plan store/binding/API, preference continuity + controls, source-message store, run binding, delegation |
| `src/knowledge/` | 7 | Acquisition provider interface, model-led investigation, Wikimedia + npm adapters, knowledge continuity/loading, historical continuation, Postgres record store |
| `src/legacy/` | 1 | Legacy test-app composition (older HTTP surface for regression comparison) |
| `src/model/` | 14 | Model Gateway: canonical request/response validation + identity, runtime with retry/provenance, provider interface, Groq/OpenAI-compatible/local-offline/fixture providers, rate-limit coordinator |
| `src/presentation/` | 7 (1 + 6 in `solandra/`) | Run/outcome → user-facing rendering: knowledge-response strings, explanation renderer, fidelity/plan/types (see §3.4) |
| `src/progress/` | 1 | Server-sent run-event stream (poll-based, terminal-status aware) |
| `src/ratelimit/` | 1 | Per-subject rate limiting for expensive intake routes (#163 on main) |
| `src/prototype/` | 1 | Android model prototype app (token-gated, specialist-guidance driven) |
| `src/recommendation/` | 3 | Recommendation record store, option derivation, continuity with governed-uncertainty preservation checks |
| `src/solandra/` | 6 | Solandra cognition: governed knowledge context, advisory runtime, action preparer, knowledge presenter/investigator, provider composition |
| `src/specialist-guidance/` | 1 + 2 resources | Prototype specialist-guidance registry + resolution (budgeting profile v1 + JSON schema) |
| `src/string/` | 1 | Canonical uncertainty-string comparison keys (comparison-only normalization for fidelity checks) |
| `src/truth/` | 33 | V36 Truth Core: pipeline, orchestrator, admission (branded admitted-evidence boundary), adjudication/atomic-core, provenance, corroboration/falsification, contracts, snapshots, durable validation, research controller/enrichment, execution pipeline |
| `src/ui/` | 7 | Server-rendered Solandra HTML pages: base conversation page + authoritative/validator/prototype/relocation/local-model variants (see §3.4) |

### 3.2 `src/` root files (36 files, grouped)

| Group | Files | Count |
|-------|-------|-------|
| Composition / entry | `index.ts` (canonical runtime assembly), `app.ts`, `runtime-app.ts`, `migrate.ts`, `runtime-config.ts`, `runtime-schema-readiness.ts`, `build-info.ts` (served revision, #165) | 7 |
| Run pipeline | `domain.ts` (schemas), `engine.ts`, `outcome.ts` (knowledge/decision outcome builders), `run-execution.ts`, `run-store.ts`, `run-worker.ts`, `run-worker-process.ts`, `run-worker-main.ts`, `research-worker.ts`, `research-worker-process.ts`, `research-worker-main.ts`, `orchestration-store.ts`, `api-control-store.ts` | 13 |
| HTTP surface | `http-app.ts`, `http-core.ts`, `consultation-intake.ts` | 3 |
| Postgres stores | `postgres-run-store.ts`, `postgres-orchestration-store.ts`, `postgres-api-control-store.ts`, `postgres-run-json.ts` | 4 |
| Live research | `live-research-binding.ts`, `live-research-model-operation.ts`, `live-research-task-executor.ts`, `live-research-worker-composition.ts`, `allowlisted-http-research-executor.ts` | 5 |
| Capability / assistance policy | `capability-execution-policy.ts`, `model-assistance-store.ts` | 2 |
| V36 research bridge | `v36-research-bridge.ts`, `v36-research-round-schema.ts` | 2 |

### 3.3 Remaining surfaces

| Area | Files | Notes |
|------|-------|-------|
| `src/presentation/solandra/` (of §3.1) | 6 | `knowledge-response.ts`, `renderer.ts`, `fidelity.ts`, `plan.ts`, `types.ts`, `index.ts` — user-visible wording + explanation plans |
| `src/specialist-guidance/resources/` | 2 | `budgeting-guidance.v1.json`, `specialist-guidance-profile.schema.json` |
| `src/ui/` (of §3.1) | 7 | `solandra-conversation-page.ts` (base), `solandra-authoritative-conversation-page.ts`, `solandra-validator-conversation-page.ts`, `solandra-prototype-page.ts`, `solandra-conversation-prototype-page.ts`, `solandra-relocation-prototype-page.ts`, `solandra-local-model-prototype-page.ts` |
| `tools/` | 20 | 13 `.mjs` (live-provider qualification, blackbox/render probes, AB benchmark, browser-lifecycle/issue harnesses, android worker) + 1 `.d.mts` pair set + 5 `.py` (deployed journey/owner-auth/event validation + tests) |
| `test/` | 215 `.test.ts` + 7 support | Support: `helpers/durable-run-worker-main.ts`, 6 `fixtures/` (foundational + legacy-bounded). New on main: `assumption-guard`, `composer-info-dump-placement`, `intake-subject-rate-limit`, `served-revision`, `subject-rate-limiter`, `agent-source-integrity`. Largest clusters: v36-* (19), issue-91-* (18), intent-* (11), issue-4x (10), m7-*/m8-*/solandra-*/live-* (8 each), knowledge-*/issue-1x (7 each) |
| `.github/workflows/` | 6 | `core-validation.yml` (durable core lane), `postgres-integration-validation.yml`, `browser-lifecycle-validation.yml`, `live-solandra-cognition-validation.yml`, `deployed-functional-validation.yml`, `render-blueprint-validation.yml` |
| `migrations/` | 40 | `005`–`032` series (runs, run-events, dispatch outbox + leases, truth sources/claims/evidence/proofs/assessments/snapshots, V36 research continuations + rounds, intent authority/lineage/clarifications/messages, conversations + ownership/deletion, decision-plan binding, preferences, prepared resources, capability authorizations, recommendations) |

**Exhaustiveness totals: 180 `src` + 20 `tools` + 222 `test` (215 + 7) + 6 workflows + 40 migrations = 468 files. Every row above appears in exactly one phase below.**

## 4. Phase plan (ordered by consequence: user-facing trust surfaces first)

Audit lanes: **C** = correctness (does it do what it claims) · **T** = trust-boundary (provenance/authority/authorization/verification separation) · **L** = language-calibration (confidence→language, no theater) · **R** = action-routing (next-step reasoning, reversibility, agency).

### Phase 1 — User-visible wording (UI strings + presenter output)

| Slice | Areas (files) | Core sections applied | Lanes | Completion evidence (exact checks) | Stop conditions |
|-------|---------------|----------------------|-------|------------------------------------|-----------------|
| 1.0 | Seed F1–F3 carry-forward; slice-1 PAUSED — no new work until Owner resumes | — | — | Owner resume directive | Any implementation without resume → stop |
| 1.1 | `src/ui/` (7): all page renderers | §10, §13, §16, §25; principles 8, 13, 14; anti-goals (Confidence Theater, Complexity Showcase) | L, T | `npm run check`; read-back of every changed string against §10/§13; targeted tests for changed renderers only | String change implies Product semantics → Owner question, stop |
| 1.2 | `src/presentation/` (7): `knowledge-response.ts`, `renderer.ts`, `solandra-presentation.ts`, fidelity/plan | §10–§15, §17; principles 2, 7, 8; anti-goals (Citation Decorator, Consensus Machine) | L, T, C | `npm run check`; read-back + targeted presenter tests; no new fixtures from Core examples | Bare-claim or theater fix needs architecture → escalate (F4/F6) |
| 1.3 | `src/outcome.ts`, `src/string/uncertainty-canonical.ts`, `src/recommendation/` (3) | §9, §12, §14; principles 2, 5, 7 | L, C | `npm run check`; uncertainty-fidelity tests pass; comparison-only normalization preserved (no stored-string mutation) | Changing canonical strings' meaning → Owner question, stop |

### Phase 2 — Cognition prompts + intent/knowledge (what Solandra may say and know)

| Slice | Areas (files) | Core sections applied | Lanes | Completion evidence (exact checks) | Stop conditions |
|-------|---------------|----------------------|-------|------------------------------------|-----------------|
| 2.1 | `src/solandra/` (6): cognition, advisory, action-preparer, knowledge-presenter/investigator, composition | §3, §32, §39–§40; principles 3, 11; Q→U separation (model proposes, Lattice governs) | T, L, C | `npm run check`; targeted cognition tests; held-out ordinary inputs per CA-04 (domains/phrasings not used as implementation targets) | Fix wants Solandra to own ordinary meaning → stop (CA-02 boundary); phrase-specific machinery → stop |
| 2.2 | `src/intent/` (22) + `src/consultation-intake.ts` | §7, §8, §32; principles 6, 14; User Intent Layer | T, C, R | `npm run check`; intent lineage/reducer/binding tests; clarification only where answer materially matters | New intent semantics not in Core → Owner question, stop |
| 2.3 | `src/knowledge/` (7) + `src/recommendation/` continuity aspect | §33–§36; principles 2, 4; Evidence/Source-Evaluation layers | T, C | `npm run check`; acquisition/continuity tests incl. Postgres variants; source-suitability metadata preserved | Source-authority rule invention → Owner question, stop |
| 2.4 | `src/specialist-guidance/` (1+2), `src/prototype/`, `src/development/` (3), `src/legacy/` | §24–§30 (accessibility/dignity); prototype surfaces are non-canonical | C | `npm run check`; prototype tests only; no canonical-surface claims | Prototype behavior cited as Product evidence → stop and relabel |

### Phase 3 — Trust core (stores, truth, decision, authority boundaries)

| Slice | Areas (files) | Core sections applied | Lanes | Completion evidence (exact checks) | Stop conditions |
|-------|---------------|----------------------|-------|------------------------------------|-----------------|
| 3.1 | `src/truth/` (33): pipeline, admission, adjudication, provenance, snapshots, durable validation | §34–§38; principles 1, 2, 5, 12; Epistemic State statuses; anti-goals (Consensus Machine, Perfect Truth Machine) | T, C | `npm run check`; full v36-* cluster (19 files) + `truth.test.ts`; branded admission boundary intact (no raw-evidence bypass) | Weakening admission/verification → stop; Assumption Guard changes beyond the merged #164 gate → Owner decision (F6 retained, not re-scoped) |
| 3.2 | `src/decision/` (12) + `src/engine.ts`, `src/domain.ts` | §33, §42; principles 5, 6, 9, 20; Problem Decomposition | T, C, R | `npm run check`; decision/generalized-engine/frontier/coverage tests; decisions traceable to admitted evidence only | New decision criteria without qualified adapter + Owner basis → stop |
| 3.3 | `src/auth/` (3), `src/capabilities/` (3), `capability-execution-policy.ts`, `model-assistance-store.ts` | §20; principle 19; decision→authorization→execution separation (CA-01) | T, C | `npm run check`; auth/capability tests; no capability gains authority semantics | Authorization-semantics change → Owner decision required, stop |
| 3.4 | `src/conversation/` (11), `src/action-preparation/` (1) | §5, §15; principles 1, 12; governed admission before presentation | T, C | `npm run check`; conversation/reference/membership tests; prepared drafts stay non-factual, non-user-authored | Draft authority upgrade (factual/user-authored) → Owner decision, stop |
| 3.5 | Postgres stores (4) + `migrations/` (40) + `postgres-run-json.ts` | State integrity; §15 durable-presentation ordering | C, T | `npm run check`; Postgres test subset (requires DB) + `runtime-schema-readiness` tests; migration-only changes never edit history | New migration contradicting applied history → stop; schema change with Product meaning → Owner question |

### Phase 4 — Workers, live research, model gateway, HTTP/runtime assembly

| Slice | Areas (files) | Core sections applied | Lanes | Completion evidence (exact checks) | Stop conditions |
|-------|---------------|----------------------|-------|------------------------------------|-----------------|
| 4.1 | Run/research workers (6 root: `run-worker*.ts`, `research-worker*.ts`) + `run-execution.ts`, `run-store.ts`, `orchestration-store.ts`, `api-control-store.ts` | Q→U→C→A stage separation; no internal vocabulary leaks to user (§16) | C, T | `npm run check`; run-coordinator/supersession/lease/ownership tests (memory + Postgres) | Stage-collapse repair → architecture gate, stop |
| 4.2 | Live research (5) + `v36-research-bridge.ts`, `v36-research-round-schema.ts` | §35, §39; research-target routing (feeds F7 unknowns work when gated) | C, T | `npm run check`; live-research-* + bridge tests; binding-failure codes preserved | Live path bypassing binding/guards → stop |
| 4.3 | `src/model/` (14): canonical, runtime, providers, rate-limit, fixture | §3, §39; principle 3 (models propose, never authorize); Model Orchestration replaceability | C, T | `npm run check`; model-*/groq-*/local-*/openai-*/pinned-* tests; canonical validation rejects malformed output | Provider-specific behavior encoded as Product rule → stop |
| 4.4 | HTTP/runtime assembly: `http-app.ts`, `http-core.ts`, `runtime-app.ts`, `index.ts`, `app.ts`, `runtime-config.ts`, `runtime-schema-readiness.ts`, `progress/run-event-stream.ts` | §16, §43 (machinery hidden; experience precise); trust-boundary composition | C, T | `npm run check`; `health.test.ts`, async-api, m7 lifecycle/stream tests; auth composition boundary test | New endpoint/surface → Product-surface restraint check; expansion → Owner authority, stop |

### Phase 5 — Tools, tests-as-surface, CI (no new machinery)

| Slice | Areas (files) | Core sections applied | Lanes | Completion evidence (exact checks) | Stop conditions |
|-------|---------------|----------------------|-------|------------------------------------|-----------------|
| 5.1 | `tools/` (20) | Tools are evidence/working state, not Product authority (LAT-SHARED-00) | C | Changed harness runs green on its documented invocation; no `src/` coupling introduced | Tool output cited as Product PASS → stop and relabel scope |
| 5.2 | `test/` support (7) + per-area regression additions | CA-04: tests establish tested contracts only; Core examples never become fixtures | C | `npm run check`; new tests target changed boundary; held-out inputs kept out of implementation | Fixture derived from Core illustration → remove, stop slice |
| 5.3 | `.github/workflows/` (6) | CI proves tested contracts only (CA-04); one durable core lane owns ordinary validation | C | `test/ci-workflow-scope.test.ts` passes; no new required lanes; no paid-capacity assumptions | New permanent lane for milestone/incident/experiment → stop (needs Owner approval) |
| 5.4 | F8 trust-outcome telemetry — SCOPED per DP-007/DP-009, authorized as a telemetry contract whose instrumentation is sequenced behind stable F4/F6 behavior (schema may proceed; instrumentation follows stable behavior) | §44 Distance to Confident Action; §45 outcome signals | — | Schema + Owner questions; instrumentation sequenced behind stable F4/F6 behavior | Instrumentation ahead of stable F4/F6 behavior → stop |

**Owner-question backlog (no inferred requirements):** F7 unknown-roadmap routing (ask vs research vs verify thresholds). Closed or resolved — not backlog: OD-001–OD-004 (closed mapping per DP-007, A4); F4 (scoped contract, authorized as the Product subsystem defined by that contract, ready for implementation planning); F5 (resolved on main, #161); F6 (implemented on main, #164; retained); F8 (scoped per DP-007/DP-009, authorized as a telemetry contract sequenced behind stable F4/F6 behavior).

## 5. Per-slice validation rule

| Change class | Required validation | Rationale |
|--------------|---------------------|-----------|
| Behavior change OR user-visible string change | Validator-agent **DIFF_REVIEW** on the exact candidate diff + `npm run check` + targeted tests for the touched boundary | Independent code validation before Steward reconciliation (LAT-SHARED-02 loop) |
| Wording-only change (no behavior, no string-meaning change) | Author read-back of each changed string against the cited Core section + `npm run check` + targeted tests for the touched renderer | Proportional cost; no expensive proof campaign for ordinary wording (CA-04) |
| Cognition-adjacent change | Above **plus** held-out ordinary inputs (unused domains/phrasings/forms, never built into implementation) per CA-04 | Known examples passing is insufficient for general capability |
| Trust-sensitive boundary (authorization, privacy/security, truth/provenance, consequential execution, state integrity) | DIFF_REVIEW + targeted tests + Postgres variants where applicable; higher proof cost justified (CA-04) | Cost matched to consequence |

Green CI / `NO_MATERIAL_FINDINGS` never equals Product PASS, merge authorization, or Core amendment. User-visible claims additionally require canonical Product-path evidence where available; otherwise state the limitation explicitly.

## 6. Anti-churn + convergence

| Rule | Detail |
|------|--------|
| One surviving candidate per objective | A slice produces exactly one candidate branch; superseded attempts are abandoned, not stacked. Do not reopen closed slices because adjacent files were touched. |
| Evidence bound to SHAs | Every claim cites repo + branch + SHA + exact command; old evidence is not current evidence after code/dependency/requirement/model changes (LAT-SHARED-01 freshness). |
| Claim states | Use `KNOWN` / `CLAIMED` / `INFERRED` / `UNKNOWN` / `DECISIVE_UNKNOWN` precisely; repetition never promotes a claim; contradictions preserved, unsupported claims downgraded. |
| Recurring-failure guard | Before repeating a repair in the same failure class, classify by example/symptom/mechanism/owning boundary; after two materially related local cognition repairs without held-out generalization, presume the boundary is wrong and escalate under CA-05. |
| Frozen / deferred list | (a) Composer `ada22fa` framing — SUPERSEDED by merged #161, no action; (b) OD-001–OD-004 gate — CLOSED per DP-007 (A4); (c) F4 authorized as the Product subsystem defined by its scoped contract — implementation planning may proceed under that contract (no building authorized by this document); F6 implemented (#164) and retained, not re-scoped; F8 authorized as a telemetry contract whose instrumentation is sequenced behind stable F4/F6 behavior; (d) slice-1 — PAUSED by Owner (wording slice `feb8e82` merged on main; audited as-is on resume); (e) slices 5.x tooling/CI — no new lanes, benchmarks, or paid capacity. |
| Handoff contract | Per-slice reports use LAT-SHARED-02 fields (`STATUS/BASE/CANDIDATE/USER-FACING OUTCOME/CHANGED BOUNDARY/IMPLEMENTATION CLAIMS/VALIDATION/DEPENDENCY/CORE BOUNDARIES/LIMITATIONS/DEVIATIONS`); validator handoff ends with the fenced complete context block. |

---

*Roadmap-only artifact. It authorizes no implementation, merges nothing, changes no Product requirement, and certifies no Product acceptance.*
