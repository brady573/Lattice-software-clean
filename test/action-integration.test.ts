/**
 * F4 Action Engine — orchestration integration regressions (Task 5).
 *
 * Covers the single shared finalization contract: candidate gating
 * (undefined never yields WAIT), real-F6 structural compatibility via a
 * test-only guard import (src never imports F6 types), and WEAKEN_AND_ASK
 * passthrough that preserves resolution without ever reaching ACT.
 *
 * Step 0 inventory note: at both F6 sites in src/consultation-intake.ts the
 * only candidate material is advisory prose (SolandraRecommendationResult
 * recommendation/alternatives strings); no owner supplies structured
 * consequence/reversibility/support dimensions, so the honest orchestration
 * state is candidate undefined + governedFacts [] → decision undefined
 * (bypass per spec §6). These tests exercise the helper for both the live
 * bypass and future structured candidates without parsing prose.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPermittedActionFacts,
  decideActionForFinalization,
  projectActionCalibration,
} from "../src/action/projection.js";
import type {
  ActionCalibrationSource,
  ActionCandidate,
} from "../src/action/types.js";
import { guardAdvisoryConclusion } from "../src/assumption/hook.js";
import type { SolandraRecommendationResult } from "../src/solandra/advisory.js";

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
    guard: { adjustedConfidence: 0.6, material: [{ support: "UNKNOWN", affectsAction: true }] },
  };
}

function cand(action: string): ActionCandidate {
  return { action, facts: [], factRefs: [] };
}

function rec(
  recommendation: string,
  uncertainties: readonly string[],
): SolandraRecommendationResult {
  return {
    status: "RECOMMENDATION",
    recommendation,
    basis: [],
    rationale: ["Governed basis supports the proposal."],
    tradeoffs: [],
    assumptions: [],
    uncertainties: [...uncertainties],
    preservedUncertainties: [],
    alternatives: [],
  };
}

test("no candidate means no decision, never WAIT", () => {
  const r = decideActionForFinalization({ screening: clearScreening(), candidate: undefined, governedFacts: [] });
  assert.equal(r.decision, undefined);
});

test("real guard output satisfies the projection source structurally (test-only F6 import)", () => {
  const screening = guardAdvisoryConclusion({ recommendation: rec("Adopt the plan.", []), governedUncertainties: [] });
  const source: ActionCalibrationSource = {
    cleared: screening.cleared,
    resolution: screening.guard.resolution,
    guard: screening.guard,
  };
  const cal = projectActionCalibration(source);
  assert.equal(cal.cleared, true);
  // The shared helper accepts the same structural projection.
  const viaHelper = decideActionForFinalization({ screening: source, candidate: undefined, governedFacts: [] });
  assert.equal(viaHelper.calibration.cleared, true);
  assert.equal(viaHelper.decision, undefined);
  // collectPermittedActionFacts is reachable on the same path.
  assert.deepEqual(collectPermittedActionFacts({ calibration: viaHelper.calibration, governedFacts: [] }), []);
});

test("WEAKEN_AND_ASK passthrough preserves resolution and never ACTs", () => {
  const r = decideActionForFinalization({ screening: weakenAskScreening(), candidate: cand("Proceed."), governedFacts: [] });
  assert.equal(r.calibration.resolution, "WEAKEN_AND_ASK");
  assert.notEqual(r.decision?.mode, "ACT");
});
