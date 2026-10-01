# DP-013 Structured Candidate Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread one optional Solandra-proposed next move through fail-closed admission into the existing F4 candidate-gated pipeline, without weakening advisory strictness or adding model, store, or execution machinery.

**Architecture:** The advisory contract admits an optional raw candidate beside the still-strict recommendation envelope and validates it independently (invalid candidate means absent, never a rejected recommendation); a single small deterministic adapter projects the admitted proposal to an F4 `ActionCandidate` carrying the action string only, so consequence/reversibility/support stay UNKNOWN by F4 construction; both existing orchestration bypass sites thread the projected candidate into `decideActionForFinalization`, preserving all three states.

**Tech Stack:** TypeScript (strict), Node 24, zod v4 (`discriminatedUnion`, `.strict()`, `safeParse`), `node:test` + `node:assert/strict` via `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-01-dp013-candidate-sourcing-design.md` (sole authority; §§1–9; no building authorized by the spec itself — this plan is the build authorization input).

## Global Constraints

- `tsconfig.json` (verified): `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, target `ES2023`, `module`/`moduleResolution` `NodeNext`. Every task's code implicitly must satisfy all four strictness flags (no unchecked index access; omit-don't-null optional fields; no `undefined` assignment to non-optional slots).
- Runtime contract (verified `package.json`): Node `>=24 <25`, npm `>=11`; observed `v24.21.0` / `11.19.0`. Scripts: `npm test` = `node --import tsx --test test/*.test.ts`; `npm run check` = `tsc` build + full suite.
- `recommendationSchema` stays `.strict()`; never weaken strictness for unrelated advisory fields (spec §3).
- Candidate proposal shape is exactly `{ action: string; expectedOutcome?: string; verification?: string }` with zero authority-bearing fields; candidate originates no governed references (spec §§3, 7).
- No persistence, no RecommendationRecord authority change, no Decision Engine change, no second model call, no prose parsing, no F8 coupling, no authorization/execution/verification/Action Preparation change, no manufactured candidates (spec §9).
- Prompt change is confined to the §4 discipline lines plus the optional-candidate contract example; no F4 vocabulary (`INVESTIGATE/TEST/ACT/WAIT/ESCALATE`) enters the prompt (spec §4).
- Allowed touch surface (STOP boundary): `src/solandra/advisory.ts`, new `src/solandra/action-candidate.ts`, threading-only edits in `src/consultation-intake.ts` at the two existing F4 bypass sites, tests under `test/`, and this plan file. Everything else (especially `src/action/*`, F6, Decision Engine, stores, model runtime) is read-only.

## Review Focus

Spec-implied but uncovered input classes most likely to bite; each names the input, the expected behavior, and the owning task whose steps pin it:

1. Whitespace-only `action` (`"   "`) in an otherwise valid envelope → candidate absent, recommendation preserved (schema `min(1)` passes whitespace, so the adapter must drop it). Pinned in Task 3.
2. Candidate smuggling authority-bearing keys (`consequence`, `support`, `claimIds`, `knowledgeId`, mode tokens) → stripped by the strict proposal schema, never becomes a governed fact; F4 dimensions stay UNKNOWN. Pinned in Task 1 (strip test) and Task 3 (no-facts test).
3. Unknown extra top-level advisory field (e.g. `confidence: 0.9`) → still rejected by `.strict()` (the new optional field must not punch a hole). Pinned in Task 1.
4. Non-`RECOMMENDATION` status (or audit-converted `NEEDS_KNOWLEDGE`) carrying candidate-shaped material → no candidate threaded; orchestration bypass unchanged. Pinned in Task 4.
5. `WEAKEN_AND_ASK` + valid candidate → F6 clarification preserved end-to-end; decision never `ACT`. Pinned in Task 4.

---

## File Structure

Studied: advisory schema + prompt lines in `src/solandra/advisory.ts` (envelope `recommendationSchema` lines 18–28, contract/prompt lines 171–230, parse site line 365, `SolandraAdvisoryRuntimeResult` lines 102–105); F4 module (`src/action/types.ts` candidate/fact types, `projection.ts` `decideActionForFinalization` lines 153–176, `evaluate.ts`, `qualify.ts` UNKNOWN-by-absence lines 110–118); F4 module `src/consultation-intake.ts` bypass sites (~lines 1388–1403 conversational, ~lines 1927–1941 continuation), both holding `advisory: SolandraAdvisoryRuntimeResult` from `.advise()` with `candidate: undefined, governedFacts: []`.

Locked decomposition (one responsibility per file; only one new module per spec §5):

- `src/solandra/advisory.ts` (modify, Task 1+2) — owns the contract boundary: optional raw candidate on the recommendation envelope (strictness preserved), the bounded `ActionCandidateProposal` schema, fail-closed `admitActionCandidate`, prompt discipline lines, and `advise()` returning the stripped result plus the admitted proposal. No F4 import; no qualification logic.
- `src/solandra/action-candidate.ts` (create, Task 3) — owns the single deterministic projection `projectCandidateToAction`: proposal → F4 `ActionCandidate` (action only, `facts: []`, `factRefs: []`) with drop rules. Imports only `ActionCandidate` type + `ActionCandidateProposal` type. No model, no store, no F4 internals, no classification (UNKNOWN falls out of `qualifyAction` by construction).
- `src/consultation-intake.ts` (modify, Task 4) — owns threading only: at both existing bypass sites, replace `candidate: undefined` with the projected `advisory.actionCandidate`. No new pipeline, no comment drift beyond the bypass note. §7 authority bindings (Goal←exact current IntentVersion, Basis←validated recommendation basis, Assumptions←post-F6 screening) are established by what the call sites already pass — Task 4 changes only the `candidate` argument.
- `test/dp013-advisory-candidate.test.ts` (create, Tasks 1+2) — schema/admission/prompt tests.
- `test/dp013-candidate-adapter.test.ts` (create, Task 3) — projection/drop-rule/UNKNOWN tests.
- `test/dp013-candidate-orchestration.test.ts` (create, Tasks 4+5) — three-state composition tests via `decideActionForFinalization` (established `action-integration.test.ts` pattern) plus Task 5 held-out cases.

---

### Task 1: Advisory schema — optional candidate, nested fail-closed admission

**Files:**
- Modify: `src/solandra/advisory.ts` (envelope schema ~lines 18–28, union lines 48–53, `SolandraAdvisoryRuntimeResult` lines 102–105, `advise()` line 365ff)
- Test: `test/dp013-advisory-candidate.test.ts`

**Interfaces:**
- Consumes: existing `recommendationSchema` (untouched), `solandraAdvisoryResultSchema` (variant swapped), zod v4.
- Produces (exact names later tasks rely on):
  - `export const actionCandidateProposalSchema: z.ZodType<...>` — `.strict()` object `{ action: z.string().min(1).max(2_000), expectedOutcome: z.string().min(1).max(2_000).optional(), verification: z.string().min(1).max(2_000).optional() }` (bounds plan-pinned to match existing prose maxima at advisory.ts lines 21–27; spec fixes only "bounded like other prose fields").
  - `export type ActionCandidateProposal = z.infer<typeof actionCandidateProposalSchema>`
  - `export function admitActionCandidate(raw: unknown): ActionCandidateProposal | undefined` — `safeParse`; success returns frozen value; failure returns `undefined`; never throws.
  - `SolandraAdvisoryRuntimeResult` gains `readonly actionCandidate?: ActionCandidateProposal` (optional so existing test doubles still compile; under `exactOptionalPropertyTypes` readers see `ActionCandidateProposal | undefined`).
  - `advise()` strips the raw field from the returned `result` and returns the admitted proposal separately; audit-converted `NEEDS_KNOWLEDGE` forces `actionCandidate: undefined`.

- [ ] **Step 1: Write the failing schema/admission tests.** In `test/dp013-advisory-candidate.test.ts`, using `node:test` + `node:assert/strict`, importing `solandraAdvisoryResultSchema` and (not-yet-existing) `admitActionCandidate`:
  - `dp013_schema_accepts_valid_optional_candidate`: envelope with all valid required RECOMMENDATION fields (status `"RECOMMENDATION"`, non-empty `recommendation`, one-entry `basis`/`rationale`, empty arrays elsewhere) plus `actionCandidate: { action: "Book the follow-up call", expectedOutcome: "A date is set", verification: "Check the calendar invite" }` parses; `admitActionCandidate` on the raw field returns the frozen proposal.
  - `dp013_schema_malformed_candidate_means_absent`: same envelope with `actionCandidate: { action: 42 }` still parses at envelope level; `admitActionCandidate` returns `undefined`.
  - `dp013_schema_strictness_preserved_for_unrelated_fields`: valid envelope plus `confidence: 0.9` throws on parse.
  - `dp013_schema_strips_authority_bearing_candidate_keys`: candidate `{ action: "Call back", consequence: "LOW", support: "SUFFICIENT", claimIds: ["c1"] }` admits to exactly `{ action: "Call back" }` (deepEqual — extra keys gone).
  - `dp013_FAILURE_BOUNDARY_invalid_required_rejects_AND_invalid_candidate_only_removes_eligibility`: (a) envelope with `recommendation: ""` plus a valid candidate throws on parse; (b) fully valid envelope with `actionCandidate: {}` (missing required `action`) parses AND `admitActionCandidate` returns `undefined`.
  - `dp013_schema_absent_candidate_identical_behavior`: envelope with no `actionCandidate` parses to an object with no `actionCandidate` key (`"actionCandidate" in parsed === false`).
- [ ] **Step 2: Run to verify they fail.** Run: `node --import tsx --test test/dp013-advisory-candidate.test.ts`. Expected: FAIL (import error on `admitActionCandidate` / assertion failures).
- [ ] **Step 3: Implement in `src/solandra/advisory.ts`.** Keep `recommendationSchema` byte-identical; add `const recommendationEnvelopeSchema = recommendationSchema.extend({ actionCandidate: z.unknown().optional() }).strict()`; swap the union's first variant to the envelope; add the proposal schema/type + `admitActionCandidate` (safeParse → frozen value or `undefined`, no throw); in `advise()`, after parse: non-`RECOMMENDATION` returns `{ result, actionCandidate: undefined, ... }`; on `RECOMMENDATION` destructure out the raw field, admit it, freeze the stripped remainder as `result`, run basis validation + grounding audit on the stripped result, and return `actionCandidate: needsKnowledge ? undefined : admitted`.
- [ ] **Step 4: Run tests to verify pass.** Run: `node --import tsx --test test/dp013-advisory-candidate.test.ts`. Expected: PASS (6 pass, 0 fail). Then `npx tsc -p tsconfig.json --noEmit` (or `npm run build`). Expected: clean (proves `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` hold).
- [ ] **Step 5: Commit.** `git add src/solandra/advisory.ts test/dp013-advisory-candidate.test.ts` then `git commit -m "feat(dp013): advisory optional candidate admission, fail-closed"`.

### Task 2: Prompt discipline lines (spec §4 wording, no F4 vocabulary)

**Files:**
- Modify: `src/solandra/advisory.ts` (`buildAdvisoryRequest` lines 160–230; export the function for inspection)
- Test: `test/dp013-advisory-candidate.test.ts` (append prompt tests)

**Interfaces:**
- Consumes: Task 1 (nothing new needed).
- Produces: `export function buildAdvisoryRequest(model: string, input: SolandraAdvisoryInput): CanonicalModelRequest` (same signature, newly exported; pure function, no behavior change) with two added system lines + optional-candidate contract example. `buildGroundingAuditRequest` explicitly UNCHANGED (candidate is proposal material, never evidence — audit covers advisory factual premises only).

- [ ] **Step 1: Write the failing prompt tests** (append to `test/dp013-advisory-candidate.test.ts`), building a minimal `SolandraAdvisoryInput` and calling `buildAdvisoryRequest("test-model", input)`:
  - `dp013_prompt_describes_candidate_as_optional_proposal_only`: system content contains `"proposal material only"` and `"naturally follows the recommendation"`.
  - `dp013_prompt_prohibits_authorization_classification_mode`: system content contains `"must not state whether Lattice should authorize or execute it"` and `"must not classify its safety, consequence, or reversibility"` and `"must not select a mode"`.
  - `dp013_prompt_has_no_f4_vocabulary`: none of the tokens `INVESTIGATE`, `TEST`, `ACT`, `WAIT`, `ESCALATE` appear in the system content (case-sensitive substring scan).
  - `dp013_prompt_contract_shows_optional_candidate_shape`: the contract JSON string parses to an array whose first shape has an `actionCandidate` key with exactly the keys `action`, `expectedOutcome`, `verification`.
- [ ] **Step 2: Run to verify they fail.** Run: `node --import tsx --test test/dp013-advisory-candidate.test.ts`. Expected: FAIL on the 4 new tests (discipline lines absent).
- [ ] **Step 3: Implement.** Insert after the `"You are non-authoritative..."` system line (line 195) exactly: `"You may include one optional actionCandidate: a single prospective next move that naturally follows the recommendation, as proposal material only."` and `"The candidate must not state whether Lattice should authorize or execute it, must not classify its safety, consequence, or reversibility, and must not select a mode."`; add the optional `actionCandidate` example object to the first contract shape only; change `function buildAdvisoryRequest` to `export function buildAdvisoryRequest`. No other prompt line touched.
- [ ] **Step 4: Run tests to verify pass.** Run: `node --import tsx --test test/dp013-advisory-candidate.test.ts`. Expected: PASS (10 pass, 0 fail).
- [ ] **Step 5: Commit.** `git add src/solandra/advisory.ts test/dp013-advisory-candidate.test.ts` then `git commit -m "feat(dp013): candidate prompt discipline lines, no F4 vocabulary"`.

### Task 3: Deterministic admission-to-F4 projection adapter

**Files:**
- Create: `src/solandra/action-candidate.ts`
- Test: `test/dp013-candidate-adapter.test.ts`

**Interfaces:**
- Consumes: `ActionCandidateProposal` (Task 1), `ActionCandidate` type from `src/action/types.ts` (type-only import; no logic import).
- Produces (exact signature Task 4 relies on):
  - `export function projectCandidateToAction(proposal: ActionCandidateProposal | undefined): ActionCandidate | undefined` — `undefined` in → `undefined` out; whitespace-only `action` → `undefined`; otherwise frozen `{ action: proposal.action, facts: [], factRefs: [] }`. `expectedOutcome`/`verification` are validated-but-not-forwarded (proposal material, never evidence; F4's `evaluate()` renders those strings from fixed templates; non-goals forbid persisting them anywhere). No dimension facts are ever emitted, so `consequence`/`reversibility`/`support` stay UNKNOWN by `qualifyAction` construction. No lexical policing of prose (no keyword scans, no thresholds).

- [ ] **Step 1: Write the failing adapter tests** in `test/dp013-candidate-adapter.test.ts`:
  - `dp013_projection_maps_action_only`: `projectCandidateToAction({ action: "Ring the clinic" })` deepEquals `{ action: "Ring the clinic", facts: [], factRefs: [] }`.
  - `dp013_projection_absent_stays_absent`: `projectCandidateToAction(undefined)` is `undefined`.
  - `dp013_projection_drops_whitespace_action` (Review Focus 1): `projectCandidateToAction({ action: "   " })` is `undefined`.
  - `dp013_projection_forwards_no_evidence_fields` (Review Focus 2, part 2): output of a proposal with `expectedOutcome`/`verification` still deepEquals `{ action, facts: [], factRefs: [] }`; `facts` has length 0.
  - `dp013_projection_unknown_by_construction`: feeding the projected candidate plus `[]` qualifiedFacts through `qualifyAction` yields `consequence: "UNKNOWN"`, `reversibility: "UNKNOWN"`, `support: "UNKNOWN"` (imports `qualifyAction` from `src/action/qualify.ts` in this test only, mirroring the integration-test pattern).
  - `dp013_projection_deterministic`: two calls on the same proposal deepEqual each other and the result `Object.isFrozen` is true.
- [ ] **Step 2: Run to verify they fail.** Run: `node --import tsx --test test/dp013-candidate-adapter.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/solandra/action-candidate.ts`.** Type-only imports; trim-check drop rule; conditional-spread-free construction compatible with `exactOptionalPropertyTypes`; `Object.freeze` on output. File header comment records the §7 mapping (action←proposal; expectedOutcome/verification←proposal-never-evidence; Goal/Basis/Assumptions bound at Task 4 call sites; consequence/reversibility←UNKNOWN absent structured facts).
- [ ] **Step 4: Run tests to verify pass.** Run: `node --import tsx --test test/dp013-candidate-adapter.test.ts`. Expected: PASS (6 pass, 0 fail). Then `npx tsc -p tsconfig.json --noEmit`. Expected: clean.
- [ ] **Step 5: Commit.** `git add src/solandra/action-candidate.ts test/dp013-candidate-adapter.test.ts` then `git commit -m "feat(dp013): candidate-to-F4 projection adapter with UNKNOWN defaults"`.

### Task 4: Orchestrator threading into the existing F4 bypass sites (three states preserved)

**Files:**
- Modify: `src/consultation-intake.ts` (two bypass sites ~1395–1403 and ~1933–1941 + import; bypass comment blocks only)
- Test: `test/dp013-candidate-orchestration.test.ts`

**Interfaces:**
- Consumes: `advisory.actionCandidate` (Task 1), `projectCandidateToAction` (Task 3), `decideActionForFinalization` (existing, unchanged).
- Produces: both sites compute `const actionCandidate = projectCandidateToAction(advisory.actionCandidate)` and pass `candidate: actionCandidate` with `governedFacts: []` unchanged. No signature changes; Decision Engine untouched; `WEAKEN_AND_ASK` interplay unchanged.

- [ ] **Step 1: Write the failing composition tests** in `test/dp013-candidate-orchestration.test.ts`, following the `action-integration.test.ts` pattern (screenings + `decideActionForFinalization`), where "present" means `projectCandidateToAction({ action: ... })` and "absent" means `projectCandidateToAction(undefined)`:
  - `dp013_orch_present_candidate_clear_yields_decision_echoing_action`: CLEAR screening + present candidate → `decision !== undefined`, `decision.action` equals the proposal action verbatim.
  - `dp013_orch_absent_candidate_yields_no_decision_never_wait`: CLEAR and WEAKEN_AND_ASK screenings + absent candidate → `decision === undefined` in both (absence is never WAIT).
  - `dp013_orch_non_recommendation_carries_no_candidate` (Review Focus 4): `projectCandidateToAction(undefined)` (what `advise()` returns for non-`RECOMMENDATION`/audit-converted statuses) threaded into a CLEAR screening → `decision === undefined`.
  - `dp013_orch_weaken_and_ask_preserved_with_candidate` (Review Focus 5): WEAKEN_AND_ASK + affectsAction screening + present candidate → `calibration.resolution === "WEAKEN_AND_ASK"` passes through AND (`decision === undefined` OR `decision.mode !== "ACT"`).
- [ ] **Step 2: Run to verify they fail.** Run: `node --import tsx --test test/dp013-candidate-orchestration.test.ts`. Expected: FAIL (module under test exists, but assertions on threadingHelpers — practically: at least the echo/absence tests fail before the intake edit; if composition alone passes pre-edit, this step instead demonstrates the intake sites still hardcode `candidate: undefined` via a `grep` check recorded in the step output).
- [ ] **Step 3: Implement threading.** At both bypass sites replace `candidate: undefined,` with the projected `advisory.actionCandidate`; refresh each site's bypass comment to state: validated candidate when present, absent means no ActionDecision (never WAIT), governedFacts still `[]` (candidate adds no references), runs after F6, presentation/store/Decision Engine untouched.
- [ ] **Step 4: Run tests to verify pass.** Run: `node --import tsx --test test/dp013-candidate-orchestration.test.ts`. Expected: PASS (4 pass, 0 fail). Then `npx tsc -p tsconfig.json --noEmit`. Expected: clean.
- [ ] **Step 5: Commit.** `git add src/consultation-intake.ts test/dp013-candidate-orchestration.test.ts` then `git commit -m "feat(dp013): thread validated candidates into F4 bypass sites"`.

### Task 5: Full gate + held-out evidence + surface audit

**Files:**
- Modify: none in `src/` (evidence only).
- Test: append held-out cases to `test/dp013-candidate-orchestration.test.ts` (or `test/dp013-candidate-adapter.test.ts` where fitting); no implementation.

**Interfaces:**
- Consumes: all Tasks 1–4. Produces: the release gate evidence for this plan.

- [ ] **Step 1: Add held-out generalization cases** (phrasings/domains never used in Tasks 1–4 implementation or tests — e.g. a cooking-domain action `"Simmer the stock for twenty minutes"`, a repair-domain action with conversational hedging, and a candidate with an empty-string `verification` which must fail admission atomically → absent):
  - `dp013_heldout_ordinary_prose_action_admits`: unseen-domain valid proposal admits and projects with action echoed verbatim.
  - `dp013_heldout_empty_optional_field_drops_candidate`: `{ action: "Defrost the freezer", verification: "" }` → `admitActionCandidate` returns `undefined` (atomic fail-closed, no field-level repair).
  - `dp013_heldout_no_example_derived_thresholds`: `grep -rn "length\|includes\|match\|test(" src/solandra/action-candidate.ts` shows no string-content policing beyond the whitespace trim check (record output in the step).
- [ ] **Step 2: Run the narrow suites.** Run: `node --import tsx --test test/dp013-advisory-candidate.test.ts test/dp013-candidate-adapter.test.ts test/dp013-candidate-orchestration.test.ts`. Expected: all PASS, 0 fail.
- [ ] **Step 3: Surface audit (no model/store/F8/persistence; prompt diff confined).** Run and record outputs: `git diff --stat` (or `git status --short` + per-commit file lists) shows only `src/solandra/advisory.ts`, `src/solandra/action-candidate.ts`, `src/consultation-intake.ts`, `test/dp013-*.test.ts`; `grep -c "\.strict()" src/solandra/advisory.ts` unchanged-or-increased (strictness never removed); `grep -rn "RecommendationStore\|emitF8\|decisionEngine\|DecisionEngine" src/solandra/action-candidate.ts src/solandra/advisory.ts` returns nothing new (no new coupling); `git diff src/solandra/advisory.ts` prompt hunk contains only the two discipline lines + contract example (record confirmation).
- [ ] **Step 4: Run the full gate.** Run: `npm run check`. Expected: `tsc` clean + entire suite PASS (no regressions). Run: `git diff --check`. Expected: clean (no whitespace errors).
- [ ] **Step 5: Commit.** `git add test/dp013-candidate-orchestration.test.ts test/dp013-candidate-adapter.test.ts` then `git commit -m "test(dp013): held-out evidence and surface audit"`. Do NOT push.

## Self-Review

1. **Spec coverage:** §1 authority/non-goals → Global Constraints + Task 5 audit. §2 pipeline order → Tasks 1 (admission after envelope acceptance inside `advise()`), 3+4 (projection after F6 at call sites). §3 contract mechanics → Task 1 (envelope + independent safeParse + FAILURE-BOUNDARY test). §4 prompt → Task 2 (exact lines, no F4 vocabulary, audit request pinned unchanged). §5 split ops → Tasks 1 (admission) + 3 (projection), one new module. §6 orchestration → Task 4 (`candidate !== undefined ? evaluate : undefined` via existing gating, absence never WAIT). §7 mapping → Task 3 header comment + Task 4 call-site bindings + UNKNOWN-by-construction test. §8 testing → schema/FAILURE-BOUNDARY/adapter/orchestration/determinism/held-out across Tasks 1, 3, 4, 5. §9 non-goals → Constraints + Task 5 audit. No gap found.
2. **Step scan:** Fixed during writing — Task 4 Step 2 initially assumed composition tests would fail pre-edit, but composition is pre-existing behavior; rewrote the step so the checkable result is the grep-demonstrated hardcoded `candidate: undefined` at both intake sites. All other steps each demand exactly one artifact (named test with assertions, named command with expected output, or exact commit message).
3. **Type consistency:** `ActionCandidateProposal` (Task 1) → consumed by `admitActionCandidate` return, `SolandraAdvisoryRuntimeResult.actionCandidate`, and `projectCandidateToAction` parameter (Task 3) — same name/type everywhere. `ActionCandidate` is type-only import in the adapter; no duplicate candidate types introduced. `recommendationEnvelopeSchema` is module-private; public `SolandraRecommendationResult` stays stripped (advise destructures), so `validateAndProjectRecommendationBasis` and recommendation stores see the pre-DP-013 shape.
4. **Review Focus completeness:** all five lines each name input + expected behavior + owning task, and each owning task contains the pinning test (`dp013_projection_drops_whitespace_action`; strip + no-facts tests; strictness test; non-recommendation test; WEAKEN_AND_ASK test). No empty section.
5. **Proportion:** spec is 29 lines; plan states interfaces, exact test names/assertions, commands, and commit messages without transcribing function bodies (bodies are one-liners the signatures + tests determine, except the two spec-§4 prompt sentences, which are quoted because the spec fixes their meaning). No bloat found; prompt-wording quotes and the §7 mapping comment are the only verbatim blocks, both justified.
