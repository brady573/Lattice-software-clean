/**
 * F4 Action Engine — projection boundary regressions (Task 1).
 *
 * Covers the ONLY F6-touching surface: structural calibration projection,
 * allowlist filtering, and the single F6 signal fact. No logic beyond the
 * projection boundary lives here.
 *
 * Held-out note (CA-04): projection is a pure structural rule with no domain
 * logic, so generalization holds by construction. Action strings below are
 * absent by design — projection never reads prose — and calibration shapes
 * vary resolution/cleared/confidence independently of domain.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPermittedActionFacts,
  projectActionCalibration,
} from "../src/action/projection.js";
import type {
  ActionCalibration,
  StructuredActionFact,
} from "../src/action/types.js";

function clearCal(): ActionCalibration {
  return {
    cleared: true,
    resolution: "CLEAR",
    adjustedConfidence: 1,
    materialAffectsAction: false,
    hasUnknownMaterial: false,
  };
}

function weakenAskCal(): ActionCalibration {
  return {
    cleared: false,
    resolution: "WEAKEN_AND_ASK",
    adjustedConfidence: 0.6,
    materialAffectsAction: true,
    hasUnknownMaterial: true,
  };
}

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
