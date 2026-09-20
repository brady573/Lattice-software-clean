import assert from "node:assert/strict";
import test from "node:test";
import { QualifiedCriterionCatalog } from "../src/decision/criterion-catalog.js";
import {
  DecisionQualificationUnresolvedError,
} from "../src/decision/decision-input-snapshot.js";
import { qualifiedDecisionNeed } from "../src/consultation-intake.js";
import { buildDecisionInputFromGeneralizedIntent } from "../src/intent/generalized-decision-planning.js";
import type { IntentVersion } from "../src/intent/types.js";

const provenance = {
  kind: "EXPLICIT_USER" as const,
  logicalUserTurnId: "turn-qualification-1",
  sourceMessageId: "message-qualification-1",
  sourceDigest: "digest-qualification-1",
};

function catalog(): QualifiedCriterionCatalog {
  return new QualifiedCriterionCatalog(1, [{
    criterionId: "cost",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "LOWER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  }]);
}

function versionWithPreference(criterionId: string): IntentVersion {
  return {
    intentScopeId: "consultation:qualification",
    intentVersionId: "intent-qualification-v1",
    version: 1,
    predecessorIntentVersionId: null,
    transitionId: "transition-qualification-v1",
    lineageKind: "INITIAL",
    lineageTargetIntentVersionId: null,
    state: {
      objective: {
        value: { state: "VALUE", value: "Choose an option." },
        provenance,
      },
      requirements: {},
      preferences: {
        [criterionId]: {
          value: { state: "VALUE", value: "MATTERS_MOST" },
          provenance,
        },
      },
    },
    createdAt: "2026-09-20T00:00:00.000Z",
  };
}

test("legitimate inability to qualify USER decision semantics remains UNRESOLVED", () => {
  assert.deepEqual(
    qualifiedDecisionNeed(versionWithPreference("unqualified-criterion"), catalog()),
    { decisionNeed: "UNRESOLVED" },
  );
});

test("expected inability to qualify has an explicit typed representation", () => {
  assert.throws(
    () => buildDecisionInputFromGeneralizedIntent({
      intentScopeId: "consultation:qualification",
      intentVersionId: "intent-qualification-v1",
      objective: { value: "Choose an option.", provenance },
      decisionSemantics: {
        hardRequirements: {},
        priorities: {
          "unqualified-criterion": {
            value: { state: "VALUE", tier: "MATTERS_MOST" },
            provenance,
          },
        },
        tolerances: {},
      },
    }, catalog()),
    (error: unknown) => error instanceof DecisionQualificationUnresolvedError,
  );
});

test("unexpected qualification failures propagate instead of masquerading as UNRESOLVED", () => {
  class FailingCatalog extends QualifiedCriterionCatalog {
    override getLatest(
      _criterionId: string,
    ): ReturnType<QualifiedCriterionCatalog["getLatest"]> {
      throw new Error("injected qualification runtime failure");
    }
  }

  const failing = new FailingCatalog(1, [{
    criterionId: "cost",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "LOWER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  }]);

  assert.throws(
    () => qualifiedDecisionNeed(versionWithPreference("cost"), failing),
    /injected qualification runtime failure/,
  );
});

test("absence of qualified decision material remains a legitimate UNRESOLVED Product state", () => {
  const version = versionWithPreference("cost");
  version.state.preferences = {};
  assert.deepEqual(qualifiedDecisionNeed(version, catalog()), { decisionNeed: "UNRESOLVED" });
  assert.deepEqual(qualifiedDecisionNeed(version, undefined), { decisionNeed: "UNRESOLVED" });
});
