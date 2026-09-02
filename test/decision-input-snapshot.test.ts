import assert from "node:assert/strict";
import test from "node:test";
import { QualifiedCriterionCatalog } from "../src/decision/criterion-catalog.js";
import { buildDecisionInputSnapshot } from "../src/decision/decision-input-snapshot.js";

function catalog(): QualifiedCriterionCatalog {
  return new QualifiedCriterionCatalog(7, [
    {
      criterionId: "quality",
      version: 1,
      valueType: "NUMBER",
      preferenceDirection: "HIGHER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 5 },
    },
    {
      criterionId: "quality",
      version: 2,
      valueType: "NUMBER",
      preferenceDirection: "HIGHER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 4 },
    },
    {
      criterionId: "cost",
      version: 3,
      valueType: "NUMBER",
      preferenceDirection: "LOWER_IS_BETTER",
      meaningfulDifference: { kind: "ABSOLUTE", minimum: 10 },
    },
  ]);
}

test("DecisionInput snapshot binds exact IntentVersion meaning to one qualified catalog snapshot", () => {
  const snapshot = buildDecisionInputSnapshot({
    intentScopeId: "scope-g1b",
    intentVersionId: "intent-g1b-v4",
    objective: "Choose the best qualified option.",
    hardRequirements: [
      { criterionId: "cost", operator: "LTE", expected: 100 },
    ],
    priorities: [
      { criterionId: "quality", tier: "MATTERS_MOST" },
      { criterionId: "cost", tier: "IMPORTANT" },
    ],
    tolerances: [
      { criterionId: "cost", kind: "ABSOLUTE", maximumDifference: 5 },
    ],
  }, catalog());

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.intentScopeId, "scope-g1b");
  assert.equal(snapshot.intentVersionId, "intent-g1b-v4");
  assert.equal(snapshot.criterionCatalogVersion, 7);
  assert.deepEqual(snapshot.hardRequirements, [
    { criterionId: "cost", criterionVersion: 3, operator: "LTE", expected: 100 },
  ]);
  assert.deepEqual(snapshot.priorities, [
    { criterionId: "quality", criterionVersion: 2, tier: "MATTERS_MOST" },
    { criterionId: "cost", criterionVersion: 3, tier: "IMPORTANT" },
  ]);
  assert.deepEqual(snapshot.tolerances, [
    {
      intentScopeId: "scope-g1b",
      intentVersionId: "intent-g1b-v4",
      criterionId: "cost",
      criterionVersion: 3,
      kind: "ABSOLUTE",
      maximumDifference: 5,
    },
  ]);
  assert.deepEqual(snapshot.criterionBindings, [
    { criterionId: "cost", criterionVersion: 3 },
    { criterionId: "quality", criterionVersion: 2 },
  ]);
});

test("DecisionInput snapshot fails closed when a referenced criterion is not qualified", () => {
  assert.throws(
    () => buildDecisionInputSnapshot({
      intentScopeId: "scope-g1b",
      intentVersionId: "intent-g1b-v4",
      objective: "Choose an option.",
      hardRequirements: [],
      priorities: [{ criterionId: "unknown", tier: "IMPORTANT" }],
      tolerances: [],
    }, catalog()),
    /No qualified CriterionDefinition exists for unknown/,
  );
});

test("DecisionInput snapshot fails closed when requirement value type conflicts with catalog semantics", () => {
  assert.throws(
    () => buildDecisionInputSnapshot({
      intentScopeId: "scope-g1b",
      intentVersionId: "intent-g1b-v4",
      objective: "Choose an option.",
      hardRequirements: [{ criterionId: "cost", operator: "LTE", expected: "cheap" }],
      priorities: [],
      tolerances: [],
    }, catalog()),
    /value type does not match qualified CriterionDefinition cost@3/,
  );
});

test("DecisionInput snapshot rejects duplicate semantic references instead of silently overriding them", () => {
  assert.throws(
    () => buildDecisionInputSnapshot({
      intentScopeId: "scope-g1b",
      intentVersionId: "intent-g1b-v4",
      objective: "Choose an option.",
      hardRequirements: [],
      priorities: [
        { criterionId: "quality", tier: "MATTERS_MOST" },
        { criterionId: "quality", tier: "IMPORTANT" },
      ],
      tolerances: [],
    }, catalog()),
    /Duplicate priority criterion reference: quality/,
  );
});
