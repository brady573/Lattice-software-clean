import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePreferenceCoverage,
  type PreferenceEvaluationInput,
} from "../src/decision/preference-coverage.js";

function evaluate(overrides: Partial<PreferenceEvaluationInput> = {}) {
  return evaluatePreferenceCoverage({
    criterionId: "performance.score",
    criterionVersion: 1,
    utility: 0.84,
    coverage: "COMPLETE",
    unresolvedGap: "NONE",
    ...overrides,
  });
}

test("known utility remains separate from complete coverage", () => {
  const result = evaluate();
  assert.equal(result.utility, 0.84);
  assert.equal(result.utilityState, "KNOWN");
  assert.equal(result.coverage, "COMPLETE");
  assert.equal(result.resolutionOwner, "NONE");
  assert.equal(result.rankingStable, true);
});

test("unknown utility is preserved as null rather than converted to zero", () => {
  const result = evaluate({
    utility: null,
    coverage: "NONE",
    unresolvedGap: "EVIDENCE",
  });
  assert.equal(result.utility, null);
  assert.equal(result.utilityState, "UNKNOWN");
  assert.notEqual(result.utility, 0);
  assert.equal(result.rankingStable, false);
});

test("evidence gaps route to V36 without creating an epistemic verdict", () => {
  const result = evaluate({
    utility: null,
    coverage: "PARTIAL",
    unresolvedGap: "EVIDENCE",
  });
  assert.equal(result.resolutionOwner, "V36");
  assert.equal(result.unresolvedGap, "EVIDENCE");
});

test("preference intent gaps route to Intent Authority", () => {
  const result = evaluate({
    utility: null,
    coverage: "COMPLETE",
    unresolvedGap: "INTENT",
  });
  assert.equal(result.resolutionOwner, "INTENT_AUTHORITY");
  assert.equal(result.rankingStable, false);
});

test("boundedly irresolvable gaps remain explicit limitations", () => {
  const result = evaluate({
    utility: 0.7,
    coverage: "PARTIAL",
    unresolvedGap: "IRRESOLVABLE",
  });
  assert.equal(result.resolutionOwner, "EXPLICIT_LIMITATION");
  assert.equal(result.utility, 0.7);
  assert.equal(result.rankingStable, false);
});

test("partial coverage cannot be reported as stable ranking", () => {
  const result = evaluate({
    coverage: "PARTIAL",
    unresolvedGap: "NONE",
  });
  assert.equal(result.utilityState, "KNOWN");
  assert.equal(result.rankingStable, false);
});

test("invalid utility and contradictory coverage states fail closed", () => {
  assert.throws(() => evaluate({ utility: 1.1 }));
  assert.throws(() => evaluate({
    utility: null,
    coverage: "PARTIAL",
    unresolvedGap: "NONE",
  }), /Unknown preference utility requires an explicit unresolved gap/);
  assert.throws(() => evaluate({
    utility: null,
    coverage: "COMPLETE",
    unresolvedGap: "EVIDENCE",
  }), /Complete coverage cannot carry an unresolved evidence gap/);
  assert.throws(() => evaluate({
    utility: 0.5,
    coverage: "NONE",
    unresolvedGap: "INTENT",
  }), /utility cannot be known when coverage is NONE/);
});
