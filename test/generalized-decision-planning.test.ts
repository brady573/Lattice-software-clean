import assert from "node:assert/strict";
import test from "node:test";
import { QualifiedCriterionCatalog } from "../src/decision/criterion-catalog.js";
import { buildDecisionInputFromGeneralizedIntent } from "../src/intent/generalized-decision-planning.js";

const provenance = {
  kind: "EXPLICIT_USER" as const,
  logicalUserTurnId: "turn-g1d-1",
  sourceMessageId: "message-g1d-1",
  sourceDigest: "digest-g1d-1",
};

function catalog(): QualifiedCriterionCatalog {
  return new QualifiedCriterionCatalog(8, [
    {
      criterionId: "cost",
      version: 2,
      valueType: "NUMBER",
      preferenceDirection: "LOWER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 10 },
    },
    {
      criterionId: "quality",
      version: 4,
      valueType: "NUMBER",
      preferenceDirection: "HIGHER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 3 },
    },
    {
      criterionId: "portability",
      version: 1,
      valueType: "NUMBER",
      preferenceDirection: "HIGHER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
    },
  ]);
}

test("generalized authoritative IntentVersion projects to exact qualified DecisionInput", () => {
  const snapshot = buildDecisionInputFromGeneralizedIntent({
    intentScopeId: "scope-g1d",
    intentVersionId: "intent-g1d-v2",
    objective: { value: "Choose the best qualified option.", provenance },
    decisionSemantics: {
      hardRequirements: {
        cost: { value: { operator: "LTE", expected: 100 }, provenance },
      },
      priorities: {
        quality: { value: { state: "VALUE", tier: "MATTERS_MOST" }, provenance },
        portability: { value: { state: "NO_PREFERENCE" }, provenance },
      },
      tolerances: {
        cost: { value: { state: "VALUE", kind: "ABSOLUTE", maximumDifference: 5 }, provenance },
      },
    },
  }, catalog());

  assert.equal(snapshot.intentScopeId, "scope-g1d");
  assert.equal(snapshot.intentVersionId, "intent-g1d-v2");
  assert.equal(snapshot.criterionCatalogVersion, 8);
  assert.deepEqual(snapshot.hardRequirements, [
    { criterionId: "cost", criterionVersion: 2, operator: "LTE", expected: 100 },
  ]);
  assert.deepEqual(snapshot.priorities, [
    { criterionId: "quality", criterionVersion: 4, tier: "MATTERS_MOST" },
  ]);
  assert.deepEqual(snapshot.tolerances, [{
    intentScopeId: "scope-g1d",
    intentVersionId: "intent-g1d-v2",
    criterionId: "cost",
    criterionVersion: 2,
    kind: "ABSOLUTE",
    maximumDifference: 5,
  }]);
  assert.deepEqual(snapshot.criterionBindings, [
    { criterionId: "cost", criterionVersion: 2 },
    { criterionId: "quality", criterionVersion: 4 },
  ]);
});

test("OPEN generalized priority fails closed instead of manufacturing a tier", () => {
  assert.throws(() => buildDecisionInputFromGeneralizedIntent({
    intentScopeId: "scope-g1d",
    intentVersionId: "intent-g1d-v3",
    objective: { value: "Choose an option.", provenance },
    decisionSemantics: {
      hardRequirements: {},
      priorities: { quality: { value: { state: "OPEN" }, provenance } },
      tolerances: {},
    },
  }, catalog()), /priority quality is OPEN/);
});

test("DELEGATED generalized tolerance fails closed instead of inventing tolerance semantics", () => {
  assert.throws(() => buildDecisionInputFromGeneralizedIntent({
    intentScopeId: "scope-g1d",
    intentVersionId: "intent-g1d-v4",
    objective: { value: "Choose an option.", provenance },
    decisionSemantics: {
      hardRequirements: {},
      priorities: {},
      tolerances: { cost: { value: { state: "DELEGATED" }, provenance } },
    },
  }, catalog()), /tolerance cost is DELEGATED/);
});
