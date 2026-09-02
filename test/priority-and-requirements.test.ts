import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePriorityTiers,
  evaluateHardRequirement,
  hardRequirementsPermitEligibility,
  priorityTierOrder,
  type HardRequirement,
} from "../src/decision/priority-and-requirements.js";

const priceLimit: HardRequirement = {
  criterionId: "price.usd",
  criterionVersion: 1,
  operator: "LTE",
  expected: 1300,
};

test("OD-003 priority tiers retain their authoritative dominance order", () => {
  assert.deepEqual(priorityTierOrder, [
    "MUST_HAVE",
    "MATTERS_MOST",
    "IMPORTANT",
    "NICE_TO_HAVE",
  ]);
  assert.equal(comparePriorityTiers("MUST_HAVE", "MATTERS_MOST") < 0, true);
  assert.equal(comparePriorityTiers("MATTERS_MOST", "IMPORTANT") < 0, true);
  assert.equal(comparePriorityTiers("IMPORTANT", "NICE_TO_HAVE") < 0, true);
  assert.equal(comparePriorityTiers("IMPORTANT", "IMPORTANT"), 0);
});

test("numeric hard requirements evaluate to SATISFIED or FAILED", () => {
  assert.equal(evaluateHardRequirement(priceLimit, 1250), "SATISFIED");
  assert.equal(evaluateHardRequirement(priceLimit, 1300), "SATISFIED");
  assert.equal(evaluateHardRequirement(priceLimit, 1450), "FAILED");

  const batteryMinimum: HardRequirement = {
    criterionId: "battery.hours",
    criterionVersion: 2,
    operator: "GTE",
    expected: 12,
  };
  assert.equal(evaluateHardRequirement(batteryMinimum, 18), "SATISFIED");
  assert.equal(evaluateHardRequirement(batteryMinimum, 10), "FAILED");
});

test("missing or non-comparable evidence remains UNKNOWN", () => {
  assert.equal(evaluateHardRequirement(priceLimit, null), "UNKNOWN");
  assert.equal(evaluateHardRequirement(priceLimit, "1250"), "UNKNOWN");

  const unsupportedOrdering: HardRequirement = {
    criterionId: "color",
    criterionVersion: 1,
    operator: "LTE",
    expected: "blue",
  };
  assert.equal(evaluateHardRequirement(unsupportedOrdering, "amber"), "UNKNOWN");
});

test("equality requirements preserve typed comparison", () => {
  const requirement: HardRequirement = {
    criterionId: "touch.enabled",
    criterionVersion: 1,
    operator: "EQ",
    expected: true,
  };
  assert.equal(evaluateHardRequirement(requirement, true), "SATISFIED");
  assert.equal(evaluateHardRequirement(requirement, false), "FAILED");
  assert.equal(evaluateHardRequirement(requirement, "true"), "UNKNOWN");
});

test("UNKNOWN cannot be treated as eligible", () => {
  assert.equal(hardRequirementsPermitEligibility(["SATISFIED", "SATISFIED"]), true);
  assert.equal(hardRequirementsPermitEligibility(["SATISFIED", "FAILED"]), false);
  assert.equal(hardRequirementsPermitEligibility(["SATISFIED", "UNKNOWN"]), false);
});

test("invalid hard-requirement identity fails closed", () => {
  assert.throws(
    () => evaluateHardRequirement({ ...priceLimit, criterionVersion: 0 }, 1200),
  );
  assert.throws(
    () => evaluateHardRequirement({ ...priceLimit, criterionId: " " }, 1200),
  );
});
