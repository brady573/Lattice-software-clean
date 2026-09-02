import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyGeneralizedDecisionIntentState,
  generalizedDecisionIntentVersionSchema,
} from "../src/intent/generalized-decision-semantics.js";

const provenance = {
  kind: "EXPLICIT_USER" as const,
  logicalUserTurnId: "turn-g1c-1",
  sourceMessageId: "message-g1c-1",
  sourceDigest: "digest-g1c-1",
};

test("generalized IntentVersion can represent confirmed requirements, priority tiers, and USER tolerances", () => {
  const version = generalizedDecisionIntentVersionSchema.parse({
    intentScopeId: "scope-g1c",
    intentVersionId: "intent-g1c-v1",
    objective: { value: "Choose a qualified option.", provenance },
    decisionSemantics: {
      hardRequirements: {
        cost: { value: { operator: "LTE", expected: 100 }, provenance },
      },
      priorities: {
        quality: { value: { state: "VALUE", tier: "MATTERS_MOST" }, provenance },
        portability: { value: { state: "NO_PREFERENCE" }, provenance },
      },
      tolerances: {
        cost: {
          value: { state: "VALUE", kind: "ABSOLUTE", maximumDifference: 5 },
          provenance,
        },
      },
    },
  });

  assert.equal(version.decisionSemantics.priorities.quality?.value.state, "VALUE");
  assert.deepEqual(version.decisionSemantics.hardRequirements.cost?.value, {
    operator: "LTE",
    expected: 100,
  });
  assert.deepEqual(version.decisionSemantics.tolerances.cost?.value, {
    state: "VALUE",
    kind: "ABSOLUTE",
    maximumDifference: 5,
  });
});

test("generalized Intent Authority semantics preserve explicit OPEN and DELEGATED states", () => {
  const version = generalizedDecisionIntentVersionSchema.parse({
    intentScopeId: "scope-g1c",
    intentVersionId: "intent-g1c-v2",
    objective: { value: "Choose an option.", provenance },
    decisionSemantics: {
      hardRequirements: {},
      priorities: {
        quality: { value: { state: "OPEN" }, provenance },
        portability: { value: { state: "DELEGATED" }, provenance },
      },
      tolerances: {},
    },
  });

  assert.equal(version.decisionSemantics.priorities.quality?.value.state, "OPEN");
  assert.equal(version.decisionSemantics.priorities.portability?.value.state, "DELEGATED");
});

test("generalized Intent Authority semantics reject non-USER provenance", () => {
  assert.throws(() => generalizedDecisionIntentVersionSchema.parse({
    intentScopeId: "scope-g1c",
    intentVersionId: "intent-g1c-v3",
    objective: {
      value: "Choose an option.",
      provenance: {
        kind: "INFERRED_MATERIAL",
        logicalUserTurnId: "turn-g1c-1",
        sourceMessageId: "message-g1c-1",
        sourceDigest: "digest-g1c-1",
      },
    },
    decisionSemantics: emptyGeneralizedDecisionIntentState(),
  }));
});

test("generalized USER tolerance cannot encode a negative maximum difference", () => {
  assert.throws(() => generalizedDecisionIntentVersionSchema.parse({
    intentScopeId: "scope-g1c",
    intentVersionId: "intent-g1c-v4",
    objective: { value: "Choose an option.", provenance },
    decisionSemantics: {
      hardRequirements: {},
      priorities: {},
      tolerances: {
        cost: {
          value: { state: "VALUE", kind: "ABSOLUTE", maximumDifference: -1 },
          provenance,
        },
      },
    },
  }));
});
