# F4 Action Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the F4 Action Engine as a pure, deterministic, orchestrator-invoked module that turns calibrated understanding into a justified next move (WAIT / INVESTIGATE / TEST / ACT / ESCALATE).

**Architecture:** Mirror the F6 Assumption Guard: a new dependency-free `src/action/` module (types → qualify → select → evaluate composition → projection boundary) invoked by the orchestrator at both F6 finalization sites through one shared helper, so semantics cannot drift by path. F4 reads only a bounded Action-facing projection (candidate + actionCalibration + qualified governed facts), never F6 internals or a context bag.

**Tech Stack:** TypeScript (strict, see Global Constraints), node:test + node:assert/strict, existing repo harness (`npm run build`, `node --import tsx --test`).

**Spec:** `docs/superpowers/specs/2026-09-30-f4-action-engine-design.md` — sole authority for what to build. Section numbers below (§N) refer to it.

## Global Constraints

Every task's requirements implicitly include this section.

- Pure, deterministic, ephemeral, read-only module. No persistence, store, or migration.
- No model call. Models PROPOSE/EXPLAIN; only this module's rules select the mode (DP-010).
- No F8 emission; no RecommendationRecord / Decision Engine / capability / authorization / execution / Action Preparation changes (§8).
- Qualifier classifies ONLY from structured governed facts; never parses prose. Model-authored risk labels are never qualification evidence (§3).
- Identical governed inputs → identical mode and justification-relevant state, regardless of model/provider availability (§4).
- Missing material input fails toward the less-consequential mode; ties prefer more reversible/diagnostic/information-producing; never model arbitration (§4).
- ESCALATE means external expertise/oversight is required, NOT that later execution needs authorization (§4).
- Verified tsconfig strictness (`tsconfig.json`): `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`. Consequences: never assign explicit `undefined` to an optional prop (omit the key); boolean flags use the `flag?: true` present-only idiom; guard every index access (`arr[i]` is `T | undefined`); freeze outputs with `Object.freeze` (F6 precedent).
- Follow the F6 precedent: `src/assumption/{types,guard,hook,index}.ts` shape, `test/assumption-guard.test.ts` style (factories, internal-vocabulary scan, held-out note).
- Prompt-change caveat (§8): if advisory output cannot supply a structured candidate without a cognition-contract change, STOP and surface — never quietly add prompt fields, never parse prose to recover facts.

## Review Focus

Spec-implied but uncovered input classes most likely to bite. Each line's pinning test is added to the owning task (tagged `[RF-N]` there).

1. Urgent/action-bait prose plus a model `LOW_RISK` label with zero structured facts → UNKNOWNs, never ACT (prose must not move the mode). → Task 2.
2. Two governed sources conflict on one dimension (e.g. KNOWLEDGE_V36 `LOW` vs CAPABILITY_EFFECT `HIGH` consequence) → that dimension UNKNOWN, never a silent max/min pick. → Task 2.
3. Runtime-smuggled fact source outside the 6-member allowlist (e.g. `"MODEL_RISK_LABEL"`) → dropped by the allowlist; cannot qualify, support, or veto. → Task 1.
4. TEST-eligible inputs that also require oversight (diagnostic available + oversightRequired) → ESCALATE wins over TEST. → Task 3.
5. Corrupt inputs (empty/whitespace action string; NaN adjustedConfidence) → loud throw, never an UNKNOWN-flavored decision. → Task 1 (NaN) + Task 2 (empty action).

---

## File Structure

Working facts: branch `f4-action-engine-spec`, base `e9416631a3b62bca76f0c6fcc11814fef3db36ba`. F6 finalization sites in `src/consultation-intake.ts`: conversational path (~line 1372, `assumptionScreening` → `establishConversationalRecommendation`) and continuation path (~line 1889, `continuationScreening` → `establishRecommendation`).

- Create `src/action/types.ts` — all F4 types: categorical states, fact struct + 6-member source allowlist, candidate, calibration projection + structural source, qualification, selection input/output, `ActionDecision`. No logic.
- Create `src/action/projection.ts` — the ONLY F6-touching surface: `projectActionCalibration` (structural input, never imports F6 types), `collectPermittedActionFacts` (allowlist filter + dedupe + the single F6 signal fact), `decideActionForFinalization` (one shared pipeline for both orchestration sites; added in Task 5).
- Create `src/action/qualify.ts` — `qualifyAction`: structured-facts-only classification to categorical states incl. UNKNOWN.
- Create `src/action/select.ts` — `selectMode`: locked top-down precedence over qualified states.
- Create `src/action/evaluate.ts` — `evaluate`: qualify → select → assemble `ActionDecision`. No new rules.
- Create `src/action/index.ts` — barrel (`export *`), mirroring `src/assumption/index.ts`.
- Modify `src/consultation-intake.ts` — integration blocks ONLY at the two F6 sites: call the shared helper, thread `actionDecision` into finalize/presentation. No store, shape, or prompt changes.
- Create `test/action-projection.test.ts`, `test/action-qualify.test.ts`, `test/action-select.test.ts`, `test/action-evaluate.test.ts`, `test/action-integration.test.ts` — one per task; node:test + node:assert/strict; matrix style with held-out domains.

---

### Task 1: Types + projection boundary

**Files:**
- Create: `src/action/types.ts`, `src/action/projection.ts`, `src/action/index.ts`
- Test: `test/action-projection.test.ts`

**Interfaces:**
- Consumes: nothing (first task). Structural shape of `AdvisoryAssumptionScreening` (read, never import: `{ cleared, resolution: "CLEAR" | "WEAKEN" | "WEAKEN_AND_ASK", guard: { adjustedConfidence, material: [{ support, affectsAction }] } }`).
- Produces (exact names later tasks reuse verbatim):
  - `ConsequenceLevel = "LOW" | "MATERIAL" | "HIGH" | "UNKNOWN"`
  - `ReversibilityStatus = "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE" | "UNKNOWN"`
  - `ActionMode = "WAIT" | "INVESTIGATE" | "TEST" | "ACT" | "ESCALATE"`
  - `ActionSupport = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT" | "UNKNOWN"`
  - `GovernedFactSource = "CANDIDATE_PROPOSAL" | "F6_CALIBRATED_SIGNAL" | "INTENT_AUTHORITY" | "KNOWLEDGE_V36" | "DECISION_ENGINE_RESULT" | "CAPABILITY_EFFECT"`
  - `BlockingUnknown = "CONSEQUENCE_UNKNOWN" | "REVERSIBILITY_UNKNOWN" | "SUPPORT_UNKNOWN" | "MATERIAL_BLOCKER_UNRESOLVED" | "SAFEGUARD_OR_AUTHORITY_MISSING"`
  - `StructuredActionFact { source: GovernedFactSource; consequence?: ConsequenceLevel; reversibility?: ReversibilityStatus; support?: ActionSupport; materialBlocker?: true; safeguardOrAuthorityEstablished?: true; diagnosticStepAvailable?: true; infoStepAvailable?: true; oversightRequired?: true }`
  - `ActionCandidate { action: string; facts: readonly StructuredActionFact[]; factRefs: readonly string[]; modelRiskLabel?: string }` (`modelRiskLabel` rides along but is NEVER evidence)
  - `ActionCalibration { cleared: boolean; resolution: "CLEAR" | "WEAKEN" | "WEAKEN_AND_ASK"; adjustedConfidence: number; materialAffectsAction: boolean; hasUnknownMaterial: boolean }`
  - `ActionCalibrationSource` (narrow structural type mirroring the screening shape above — NOT the F6 implementation type, NOT a context bag)
  - `projectActionCalibration(source: ActionCalibrationSource): ActionCalibration`
  - `collectPermittedActionFacts(input: { calibration: ActionCalibration; governedFacts: readonly StructuredActionFact[] }): readonly StructuredActionFact[]`

- [ ] **Step 1: Write the failing test** in `test/action-projection.test.ts`: projection mapping, NaN throw [RF-5], allowlist drop [RF-3], F6 signal-fact rule.

```ts
test("projection maps cleared/resolution/confidence/material-affectsAction structurally", () => {
  const cal = projectActionCalibration({ cleared: false, resolution: "WEAKEN_AND_ASK",
    guard: { adjustedConfidence: 0.6, material: [{ support: "UNKNOWN", affectsAction: true }] } });
  assert.equal(cal.resolution, "WEAKEN_AND_ASK");
  assert.equal(cal.materialAffectsAction, true);
  assert.equal(cal.hasUnknownMaterial, true);
});
test("NaN adjustedConfidence throws [RF-5]", () => {
  assert.throws(() => projectActionCalibration({ cleared: true, resolution: "CLEAR",
    guard: { adjustedConfidence: NaN, material: [] } }), /adjustedConfidence/);
});
test("[RF-3] runtime-unknown fact source is dropped by the allowlist", () => {
  const smuggled = { source: "MODEL_RISK_LABEL", consequence: "LOW" } as unknown as StructuredActionFact;
  assert.deepEqual(collectPermittedActionFacts({ calibration: clearCal(), governedFacts: [smuggled] }), []);
});
test("F6 signal fact emitted only for WEAKEN_AND_ASK plus affectsAction", () => {
  const facts = collectPermittedActionFacts({ calibration: weakenAskCal(), governedFacts: [] });
  assert.equal(facts.some((f) => f.source === "F6_CALIBRATED_SIGNAL" && f.materialBlocker === true), true);
});
```

- [ ] **Step 2: Run it to verify failure.** Run: `node --import tsx --test test/action-projection.test.ts` Expected: FAIL (module not defined).
- [ ] **Step 3: Implement types** in `src/action/types.ts` with the exact names/unions above; `src/action/index.ts` barrel (`export * from "./types.js"; export * from "./projection.js";`).
- [ ] **Step 4: Implement `projectActionCalibration` + `collectPermittedActionFacts`** in `src/action/projection.ts`. Spec-pinned values: `materialAffectsAction` = any material item with `affectsAction true`; `hasUnknownMaterial` = any material item with support `UNKNOWN`/`UNSUPPORTED`; allowlist = the 6-member `GovernedFactSource` union (drop anything else, drop facts with no dimension/flag set, dedupe); emit one `{ source: "F6_CALIBRATED_SIGNAL", materialBlocker: true }` fact IFF resolution is `WEAKEN_AND_ASK` AND `materialAffectsAction`, else emit no signal fact. Throw on empty-missing/NaN confidence (finite-number check, F6 `requireConfidence` precedent).
- [ ] **Step 5: Run tests.** Run: `node --import tsx --test test/action-projection.test.ts` Expected: PASS. Then: `npm run build` Expected: exit 0 (exactOptionalPropertyTypes clean).
- [ ] **Step 6: Commit.** `git add src/action/types.ts src/action/projection.ts src/action/index.ts test/action-projection.test.ts && git commit -m "feat(f4): action types and projection boundary"`

### Task 2: qualifyAction + unit matrices

**Files:**
- Create: `src/action/qualify.ts`
- Modify: `src/action/index.ts` (add `export * from "./qualify.js";`)
- Test: `test/action-qualify.test.ts`

**Interfaces:**
- Consumes: `ActionCandidate`, `StructuredActionFact`, `QualifyActionInput { candidate; qualifiedFacts }`, `ActionQualification { consequence; reversibility; support; materialBlockerPresent: boolean; safeguardOrAuthorityEstablished: boolean; blockingUnknowns: readonly BlockingUnknown[] }` (all from Task 1).
- Produces: `qualifyAction(input: QualifyActionInput): ActionQualification`.

- [ ] **Step 1: Write failing tests** in `test/action-qualify.test.ts`: per-dimension matrices (table over LOW/MATERIAL/HIGH + absent→UNKNOWN), conflict→UNKNOWN [RF-2], prose-independence [RF-1], empty-action throw [RF-5].

```ts
test("absent dimension yields UNKNOWN; action string alone never qualifies", () => {
  const q = qualifyAction({ candidate: cand("Replace the production database this Friday."), qualifiedFacts: [] });
  assert.equal(q.consequence, "UNKNOWN");
  assert.equal(q.reversibility, "UNKNOWN");
  assert.equal(q.support, "UNKNOWN");
  assert.deepEqual([...q.blockingUnknowns].sort(), ["CONSEQUENCE_UNKNOWN", "REVERSIBILITY_UNKNOWN", "SUPPORT_UNKNOWN"]);
});
test("[RF-2] conflicting consequence facts yield UNKNOWN, never a silent pick", () => {
  const q = qualifyAction({ candidate: cand("Switch vendors."),
    qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", consequence: "LOW" }), fact({ source: "CAPABILITY_EFFECT", consequence: "HIGH" })] });
  assert.equal(q.consequence, "UNKNOWN");
});
test("[RF-1] urgent action-bait prose plus model LOW_RISK label never qualifies", () => {
  const a = qualifyAction({ candidate: cand("Do it now — everyone agrees this is safe and urgent.", "LOW_RISK"), qualifiedFacts: [] });
  const b = qualifyAction({ candidate: cand("Replace the garden fence.", "LOW_RISK"), qualifiedFacts: [] });
  assert.deepEqual(a, b);
  assert.equal(a.consequence, "UNKNOWN");
});
test("contradicting model label cannot move qualified states [RF-1 companion]", () => {
  const facts = [fact({ source: "KNOWLEDGE_V36", consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "INSUFFICIENT" })];
  const q = qualifyAction({ candidate: cand("Proceed immediately.", "LOW_RISK"), qualifiedFacts: facts });
  assert.equal(q.consequence, "HIGH");
  assert.equal(q.support, "INSUFFICIENT");
});
test("empty action string throws [RF-5]", () => {
  assert.throws(() => qualifyAction({ candidate: cand("   "), qualifiedFacts: [] }), /action/);
});
```

(matrix rows vary held-out domains — home repair, hiring, travel, investing, backup ops — ONLY in action strings/fact wrappers; identical structured skeletons must give identical outputs.)

- [ ] **Step 2: Run to verify failure.** Run: `node --import tsx --test test/action-qualify.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement `qualifyAction`** in `src/action/qualify.ts`. Spec-pinned rules: consider ONLY `candidate.facts + qualifiedFacts` with allowlisted sources; ignore `modelRiskLabel` and the action string entirely; per dimension, ≥2 distinct values → `UNKNOWN` (conflict rule); no establishing fact → `UNKNOWN`; `materialBlockerPresent` = any `materialBlocker`; `safeguardOrAuthorityEstablished` = any `safeguardOrAuthorityEstablished`; `blockingUnknowns` uses ONLY the fixed token union; validate `action` non-empty (mirror F6 `requireCandidate`).
- [ ] **Step 4: Run tests.** Run: `node --import tsx --test test/action-qualify.test.ts test/action-projection.test.ts` Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/action/qualify.ts src/action/index.ts test/action-qualify.test.ts && git commit -m "feat(f4): qualifyAction structured-facts-only classification"`

### Task 3: selectMode + precedence matrices

**Files:**
- Create: `src/action/select.ts`
- Modify: `src/action/index.ts` (add `export * from "./select.js";`)
- Test: `test/action-select.test.ts`

**Interfaces:**
- Consumes: `ActionQualification`, `ActionCalibration` (Task 1).
- Produces: `ModeSelectionInput { qualification; calibration; infoStepAvailable: boolean; diagnosticStepAvailable: boolean; oversightRequired: boolean }`, `ModeSelection { mode: ActionMode; reason: string }`, `selectMode(input: ModeSelectionInput): ModeSelection`.

- [ ] **Step 1: Write failing tests** in `test/action-select.test.ts`: each mode reachable; HIGH/IRREVERSIBLE ACT case; veto without safeguard; UNKNOWN-never-ACT; WEAKEN_AND_ASK veto; ties [RF-4]; default WAIT.

```ts
test("HIGH plus IRREVERSIBLE with sufficient support and established safeguard still ACTs", () => {
  assert.equal(selectMode(sel({ consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "SUFFICIENT", safeguard: true })).mode, "ACT");
});
test("HIGH plus IRREVERSIBLE with sufficient support but no safeguard vetoes ACT", () => {
  const m = selectMode(sel({ consequence: "HIGH", reversibility: "IRREVERSIBLE", support: "SUFFICIENT" }));
  assert.equal(m.mode, "WAIT");
});
test("UNKNOWN support never ACTs; info step decides INVESTIGATE vs WAIT", () => {
  assert.equal(selectMode(sel({ support: "UNKNOWN", info: true })).mode, "INVESTIGATE");
  assert.equal(selectMode(sel({ support: "UNKNOWN" })).mode, "WAIT");
});
test("WEAKEN_AND_ASK with material affectsAction vetoes ACT", () => {
  assert.equal(selectMode(sel({ support: "SUFFICIENT", consequence: "LOW", cal: weakenAskAffectsAction() })).mode, "WAIT");
});
test("[RF-4] TEST-eligible plus oversightRequired escalates", () => {
  assert.equal(selectMode(sel({ support: "PARTIAL", reversibility: "REVERSIBLE", diagnostic: true, oversight: true })).mode, "ESCALATE");
});
test("material blocker with info step investigates, else waits", () => {
  assert.equal(selectMode(sel({ blocker: true, info: true })).mode, "INVESTIGATE");
  assert.equal(selectMode(sel({ blocker: true })).mode, "WAIT");
});
```

- [ ] **Step 2: Run to verify failure.** Run: `node --import tsx --test test/action-select.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement `selectMode`** in `src/action/select.ts` with this LOCKED top-down precedence (first match wins; §4): (1) `materialBlockerPresent` → `infoStepAvailable ? INVESTIGATE : WAIT`; (2) `oversightRequired` → `ESCALATE` (external expertise required, never authorization — keep that word out of `reason`); (3) support `INSUFFICIENT`/`UNKNOWN` → `infoStepAvailable ? INVESTIGATE : WAIT`; (4) support `PARTIAL` → `diagnosticStepAvailable` AND reversibility `REVERSIBLE`/`PARTIALLY_REVERSIBLE` → `TEST`, else `infoStepAvailable ? INVESTIGATE : WAIT`; (5) support `SUFFICIENT` → veto ACT when (`WEAKEN_AND_ASK` + `materialAffectsAction`) OR (`HIGH`/`IRREVERSIBLE` without `safeguardOrAuthorityEstablished`) → `infoStepAvailable ? INVESTIGATE : WAIT`, else `ACT`; (6) default `WAIT`. `reason` is a fixed template over categorical state names only (no numbers, no prose).
- [ ] **Step 4: Run tests.** Run: `node --import tsx --test test/action-select.test.ts test/action-qualify.test.ts test/action-projection.test.ts` Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/action/select.ts src/action/index.ts test/action-select.test.ts && git commit -m "feat(f4): selectMode deterministic precedence"`

### Task 4: evaluate() composition + determinism

**Files:**
- Create: `src/action/evaluate.ts`
- Modify: `src/action/index.ts` (add `export * from "./evaluate.js";`)
- Test: `test/action-evaluate.test.ts`

**Interfaces:**
- Consumes: `qualifyAction`, `selectMode`, `ActionCalibration`, `ActionCandidate`, `StructuredActionFact` (Tasks 1–3).
- Produces: `ActionEngineInput { candidate; calibration; qualifiedFacts }`, `ActionDecision { mode; action; reason; expectedOutcome; risk; reversibility; verification; blockingUnknowns }`, `evaluate(input: ActionEngineInput): ActionDecision`.

- [ ] **Step 1: Write failing tests** in `test/action-evaluate.test.ts`: full 8-field decision; determinism incl. model-label independence; no internal vocabulary; no numeric thresholds.

```ts
test("evaluate composes qualification to selection and echoes action plus reversibility", () => {
  const d = evaluate({ candidate: cand("Approve the refund."),
    calibration: clearCal(), qualifiedFacts: [fact({ source: "KNOWLEDGE_V36", consequence: "LOW", reversibility: "REVERSIBLE", support: "SUFFICIENT" })] });
  assert.equal(d.mode, "ACT");
  assert.equal(d.action, "Approve the refund.");
  assert.equal(d.reversibility, "REVERSIBLE");
  assert.deepEqual(d.blockingUnknowns, []);
});
test("identical governed inputs give identical decisions; model labels change nothing", () => {
  const a = evaluate({ candidate: cand("Migrate the server.", "HIGH_RISK"), calibration: clearCal(), qualifiedFacts: highFacts() });
  const b = evaluate({ candidate: cand("Migrate the server.", "LOW_RISK"), calibration: clearCal(), qualifiedFacts: highFacts() });
  assert.deepEqual(a, b);
});
test("user-facing strings carry no internal vocabulary", () => {
  for (const d of [evaluate(actCase()), evaluate(waitCase()), evaluate(escalateCase())])
    assertUserVisibleClean([d.reason, d.expectedOutcome, d.risk, d.verification]);
});
test("confidence extremes do not move the mode (no numeric thresholds)", () => {
  assert.equal(evaluate({ ...base(), calibration: { ...clearCal(), adjustedConfidence: 0.01 } }).mode,
    evaluate({ ...base(), calibration: { ...clearCal(), adjustedConfidence: 0.99 } }).mode);
});
```

(`assertUserVisibleClean` mirrors the F6 `INTERNAL_VOCABULARY` list: assumption, material, epistemic, inventory, graph, guard, confidence, provenance, authorization, v36, decision engine.)

- [ ] **Step 2: Run to verify failure.** Run: `node --import tsx --test test/action-evaluate.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement `evaluate`** in `src/action/evaluate.ts`. Spec-pinned composition ONLY (no new rules): `qualifyAction({candidate, qualifiedFacts})` → derive `infoStepAvailable`/`diagnosticStepAvailable`/`oversightRequired` from qualifiedFacts flags → `selectMode(...)` → assemble `ActionDecision` with `action` echoed verbatim from `candidate.action`, `reversibility`/ `blockingUnknowns` from qualification, `reason` from selection, `expectedOutcome`/`risk`/`verification` from fixed categorical templates (deterministic; omit-not-undefined per exactOptionalPropertyTypes is NOT needed — all four are required strings; keep them required). Freeze the output.
- [ ] **Step 4: Run tests.** Run: `node --import tsx --test test/action-*.test.ts` Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/action/evaluate.ts src/action/index.ts test/action-evaluate.test.ts && git commit -m "feat(f4): evaluate composition plus determinism"`

### Task 5: Orchestration integration at both F6 sites

**Files:**
- Modify: `src/action/projection.ts` (add `decideActionForFinalization`), `src/consultation-intake.ts` (integration blocks ONLY — two call sites + finalize/presentation threading; no store, shape, or prompt edits)
- Test: `test/action-integration.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `projectActionCalibration`, `collectPermittedActionFacts` (Tasks 1, 4).
- Produces: `decideActionForFinalization(input: { screening: ActionCalibrationSource; candidate: ActionCandidate | undefined; governedFacts: readonly StructuredActionFact[] }): { calibration: ActionCalibration; qualifiedFacts: readonly StructuredActionFact[]; decision: ActionDecision | undefined }` — `candidate === undefined` → `decision: undefined` (never WAIT). THE single shared contract both sites call.

- [ ] **Step 0 (STOP gate, binds §6 + §8): Inventory structured candidate sources at both F6 sites BEFORE writing integration code.** If the only available material is advisory prose / `proposedAction` string and structuring it needs a cognition-contract (prompt) change → STOP, file a stop report (`KNOWN`/`INFERRED`/`UNKNOWN`, owning boundary, smallest next decision), write NO integration code. Do NOT parse prose to recover facts; do NOT add prompt fields.
- [ ] **Step 1: Write failing tests** in `test/action-integration.test.ts`: candidate gating, real-F6 structural compat (test-only import), WEAKEN_AND_ASK passthrough.

```ts
test("no candidate means no decision, never WAIT", () => {
  const r = decideActionForFinalization({ screening: clearScreening(), candidate: undefined, governedFacts: [] });
  assert.equal(r.decision, undefined);
});
test("real guard output satisfies the projection source structurally (test-only F6 import)", () => {
  const screening = guardAdvisoryConclusion({ recommendation: rec("Adopt the plan.", []), governedUncertainties: [] });
  const cal = projectActionCalibration(screening);
  assert.equal(cal.cleared, true);
});
test("WEAKEN_AND_ASK passthrough preserves resolution and never ACTs", () => {
  const r = decideActionForFinalization({ screening: weakenAskScreening(), candidate: cand("Proceed."), governedFacts: [] });
  assert.equal(r.calibration.resolution, "WEAKEN_AND_ASK");
  assert.notEqual(r.decision?.mode, "ACT");
});
```

- [ ] **Step 2: Run to verify failure.** Run: `node --import tsx --test test/action-integration.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement `decideActionForFinalization`** in `src/action/projection.ts`: `projectActionCalibration(screening)` → `collectPermittedActionFacts({calibration, governedFacts})` → `candidate === undefined ? decision: undefined : decision: evaluate({candidate, calibration, qualifiedFacts})`. Pure Knowledge turns (no candidate) ordinarily bypass F4 through this same gate.
- [ ] **Step 4: Wire BOTH F6 sites in `src/consultation-intake.ts`.** Site A: after the `NEEDS_CLARIFICATION` early-return following `assumptionScreening` (~line 1386), before `establishConversationalRecommendation`. Site B: after the guard-question early-return following `continuationScreening` (~line 1907), before `establishRecommendation`. Pipeline per site (helper names illustrative per §5): screening → `projectActionCalibration` → `collectPermittedActionFacts` → candidate-gated `evaluate` → `finalize({recommendation, actionDecision})`; runs after F6 even on WEAKEN_AND_ASK paths that reach finalization without suppressing/answering/reinterpreting the clarification; presentation consumes only; RecommendationStore never invokes. If `establish*Recommendation` cannot accept `actionDecision` as an optional field without a RecommendationRecord change → STOP and surface (non-goal, §8).
- [ ] **Step 5: Run tests + build.** Run: `node --import tsx --test test/action-*.test.ts` Expected: PASS. Run: `npm run build` Expected: exit 0.
- [ ] **Step 6: Commit.** `git add src/action/projection.ts src/consultation-intake.ts test/action-integration.test.ts && git commit -m "feat(f4): orchestration integration at both F6 sites"`

### Task 6: Full gate + held-out generalization evidence

**Files:** none (evidence task; commits only if fixes are needed, kept inside the allowed paths).

- [ ] **Step 1: Run the full gate.** Run: `npm run check` Expected: build exit 0; all tests pass, `fail 0`.
- [ ] **Step 2: Held-out generalization probe.** Write 3–5 fresh end-to-end cases through `evaluate` in held-out domains/phrasings NEVER used in Tasks 1–5 (e.g. if earlier tasks used home repair/hiring/travel/investing/backup ops, use pet care, carpool scheduling, book-club catering), keeping structured skeletons identical to earlier cases. Assert identical modes. This is evidence only — do NOT add these cases to the implementation or permanent fixtures; record pass/fail in the commit message or task notes. Held-out inputs must not shape code (§7: no example-derived thresholds).
- [ ] **Step 3: Non-goal + surface audit.** Run: `git diff --stat` (or `git status --short`) — touched paths must stay inside `src/action/`, `src/consultation-intake.ts` (integration blocks only), `test/action-*.test.ts`. Run: `grep -rn "from \"../model\|from \"./model\|RecommendationStore\|recommendationStore\|emitF8\|F8" src/action/` Expected: empty (no model call, no store, no F8). Run: `git diff --check` Expected: clean.
- [ ] **Step 4: Commit any fixes** (same path rules; do NOT push — report the SHA for review).

---

## Self-review record

- Spec coverage (§§1–8): §1 authority → Tasks 1/5 + Constraints; §2 one-contract/two-sites → Task 5 shared helper; §3 module/contract/output → Tasks 1/2/4; §4 precedence/consequence/ties/determinism → Tasks 3/4; §5 pipeline → Task 5; §6 candidate sourcing/gating/bypass → Tasks 2/5; §7 matrices/held-out → Tasks 2/3/4/6; §8 non-goals/stops → Constraints + Task 5 Steps 0/4 + Task 6 audit. No gap found.
- Step scan: fixed one overloaded draft step (Task 5 wiring split into implement-helper vs wire-sites).
- Type consistency: all six tasks reuse the Task 1 names verbatim (`StructuredActionFact`, `ActionCalibrationSource`, `BlockingUnknown`, `decideActionForFinalization`); `reason`/`risk` kept required strings so no `exactOptionalPropertyTypes` hazard.
- Review Focus: all five lines pinned ([RF-1] T2 ×2, [RF-2] T2, [RF-3] T1, [RF-4] T3, [RF-5] T1+T2).
- Proportion: trimmed two drafted implementation bodies to signatures + pinned values; matrices as tables/rows with exact spec values, not transcripts.
