/**
 * DP-013 candidate orchestration composition tests (Task 4).
 *
 * Three states preserved via the existing shared helper
 * `decideActionForFinalization` (established `action-integration.test.ts`
 * pattern): absent candidate → no decision (never WAIT); present candidate
 * → F4 evaluates and echoes the action verbatim; WEAKEN_AND_ASK interplay
 * unchanged (clarification preserved, never ACT).
 *
 * "Present" means `projectCandidateToAction({ action: ... })`;
 * "absent" means `projectCandidateToAction(undefined)` — exactly what the
 * Task 4 threading sites compute from `advisory.actionCandidate`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { decideActionForFinalization } from "../src/action/projection.js";
import type { ActionCalibrationSource } from "../src/action/types.js";
import { projectCandidateToAction } from "../src/solandra/action-candidate.js";

function clearScreening(): ActionCalibrationSource {
  return {
    cleared: true,
    resolution: "CLEAR",
    guard: { adjustedConfidence: 1, material: [] },
  };
}

function weakenAskScreening(): ActionCalibrationSource {
  return {
    cleared: false,
    resolution: "WEAKEN_AND_ASK",
    guard: { adjustedConfidence: 0.6, material: [] },
  };
}

function weakenAskAffectsActionScreening(): ActionCalibrationSource {
  return {
    cleared: false,
    resolution: "WEAKEN_AND_ASK",
    guard: {
      adjustedConfidence: 0.6,
      material: [{ support: "UNKNOWN", affectsAction: true }],
    },
  };
}

test("dp013_orch_present_candidate_clear_yields_decision_echoing_action", () => {
  const candidate = projectCandidateToAction({ action: "Book the follow-up call" });
  assert.notEqual(candidate, undefined);
  const r = decideActionForFinalization({
    screening: clearScreening(),
    candidate,
    governedFacts: [],
  });
  assert.notEqual(r.decision, undefined);
  assert.equal(r.decision?.action, "Book the follow-up call");
});

test("dp013_orch_absent_candidate_yields_no_decision_never_wait", () => {
  const absent = projectCandidateToAction(undefined);
  assert.equal(absent, undefined);
  const clearResult = decideActionForFinalization({
    screening: clearScreening(),
    candidate: absent,
    governedFacts: [],
  });
  assert.equal(clearResult.decision, undefined);
  const weakenResult = decideActionForFinalization({
    screening: weakenAskScreening(),
    candidate: absent,
    governedFacts: [],
  });
  assert.equal(weakenResult.decision, undefined);
});

test("dp013_orch_non_recommendation_carries_no_candidate", () => {
  // advise() returns actionCandidate undefined for non-RECOMMENDATION and
  // audit-converted NEEDS_KNOWLEDGE statuses; threading that absence into a
  // CLEAR screening must still bypass (no decision, never WAIT).
  const absent = projectCandidateToAction(undefined);
  const r = decideActionForFinalization({
    screening: clearScreening(),
    candidate: absent,
    governedFacts: [],
  });
  assert.equal(r.decision, undefined);
});

test("dp013_orch_weaken_and_ask_preserved_with_candidate", () => {
  const candidate = projectCandidateToAction({ action: "Book the follow-up call" });
  assert.notEqual(candidate, undefined);
  const r = decideActionForFinalization({
    screening: weakenAskAffectsActionScreening(),
    candidate,
    governedFacts: [],
  });
  assert.equal(r.calibration.resolution, "WEAKEN_AND_ASK");
  assert.ok(r.decision === undefined || r.decision.mode !== "ACT");
});
