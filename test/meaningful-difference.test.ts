import assert from "node:assert/strict";
import test from "node:test";
import type { CriterionDefinition } from "../src/decision/criterion-catalog.js";
import {
  evaluateMeaningfulDifference,
  type UserCriterionTolerance,
} from "../src/decision/meaningful-difference.js";

const performance: CriterionDefinition = {
  criterionId: "performance.score",
  version: 1,
  valueType: "NUMBER",
  preferenceDirection: "HIGHER_IS_BETTER",
  meaningfulDifference: { kind: "ABSOLUTE", minimum: 5 },
};

function userTolerance(maximumDifference: number): UserCriterionTolerance {
  return {
    intentScopeId: "scope-1",
    intentVersionId: "intent-version-7",
    criterionId: performance.criterionId,
    criterionVersion: performance.version,
    kind: "ABSOLUTE",
    maximumDifference,
  };
}

test("criterion-owned minimum gates domain meaningful difference", () => {
  const within = evaluateMeaningfulDifference(performance, 90, 87);
  assert.equal(within.state, "WITHIN_TOLERANCE");
  assert.equal(within.preferredSide, "NEITHER");
  assert.equal(within.absoluteDifference, 3);
  assert.equal(within.criterionMinimumDifference, 5);

  const meaningful = evaluateMeaningfulDifference(performance, 90, 85);
  assert.equal(meaningful.state, "MEANINGFUL");
  assert.equal(meaningful.preferredSide, "LEFT");
  assert.equal(meaningful.absoluteDifference, 5);
});

test("exact-IntentVersion USER tolerance can keep a domain difference non-material", () => {
  const withinUserTolerance = evaluateMeaningfulDifference(
    performance,
    90,
    82,
    userTolerance(10),
  );
  assert.equal(withinUserTolerance.state, "WITHIN_TOLERANCE");
  assert.equal(withinUserTolerance.intentScopeId, "scope-1");
  assert.equal(withinUserTolerance.intentVersionId, "intent-version-7");
  assert.equal(withinUserTolerance.userMaximumDifference, 10);

  const outsideUserTolerance = evaluateMeaningfulDifference(
    performance,
    90,
    78,
    userTolerance(10),
  );
  assert.equal(outsideUserTolerance.state, "MEANINGFUL");
  assert.equal(outsideUserTolerance.preferredSide, "LEFT");
});

test("lower-is-better direction selects the lower admitted value", () => {
  const price: CriterionDefinition = {
    criterionId: "price.usd",
    version: 2,
    valueType: "NUMBER",
    preferenceDirection: "LOWER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 25 },
  };
  const result = evaluateMeaningfulDifference(price, 1150, 1250);
  assert.equal(result.state, "MEANINGFUL");
  assert.equal(result.preferredSide, "LEFT");
});

test("missing, non-finite, and non-orderable values remain UNKNOWN", () => {
  assert.equal(evaluateMeaningfulDifference(performance, null, 80).state, "UNKNOWN");
  assert.equal(evaluateMeaningfulDifference(performance, Number.NaN, 80).state, "UNKNOWN");

  const color: CriterionDefinition = {
    criterionId: "color",
    version: 1,
    valueType: "STRING",
    preferenceDirection: "MATCH_ONLY",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 0 },
  };
  assert.equal(evaluateMeaningfulDifference(color, 1, 2).state, "UNKNOWN");
});

test("tolerance must bind the exact qualified criterion version", () => {
  assert.throws(
    () => evaluateMeaningfulDifference(
      performance,
      90,
      80,
      { ...userTolerance(2), criterionVersion: 2 },
    ),
    /does not match CriterionDefinition performance\.score@1/,
  );
});

test("equal values are never promoted into a meaningful difference", () => {
  const result = evaluateMeaningfulDifference(
    { ...performance, meaningfulDifference: { kind: "ABSOLUTE", minimum: 0 } },
    90,
    90,
    userTolerance(0),
  );
  assert.equal(result.state, "WITHIN_TOLERANCE");
  assert.equal(result.preferredSide, "NEITHER");
  assert.equal(result.absoluteDifference, 0);
});
