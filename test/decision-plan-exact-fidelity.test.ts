import assert from "node:assert/strict";
import test from "node:test";
import { QualifiedCriterionCatalog } from "../src/decision/criterion-catalog.js";
import { buildDecisionInputFromGeneralizedIntent } from "../src/intent/generalized-decision-planning.js";
import { deriveGeneralizedDecisionIntentFromState } from "../src/intent/generalized-decision-projection.js";
import {
  MemoryDecisionPlanStore,
  decisionPlanIdForRun,
} from "../src/intent/decision-plan-store.js";
import { MemoryIntentAuthorityStore } from "../src/intent/store.js";

const catalog = new QualifiedCriterionCatalog(4, [
  {
    criterionId: "capacity",
    version: 2,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 5 },
  },
  {
    criterionId: "efficiency",
    version: 3,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
]);

async function exactPlanFixture() {
  const intentStore = new MemoryIntentAuthorityStore(() => "intent-exact-v1");
  const scope = await intentStore.createScope({
    intentScopeId: "scope-exact",
    kind: "consultation",
    initialTransition: {
      transitionId: "transition-exact-v1",
      intentScopeId: "scope-exact",
      baseIntentVersionId: null,
      logicalUserTurnId: "turn-exact-v1",
      observedMessageHorizon: 1,
      sourceMessageId: "message-exact-v1",
      sourceDigest: "a".repeat(64),
      operations: [
        {
          op: "SET",
          path: { kind: "OBJECTIVE" },
          value: { state: "VALUE", value: "Compare the eligible alternatives." },
        },
        {
          op: "SET",
          path: { kind: "REQUIREMENT", key: "capacity::min" },
          value: { state: "VALUE", value: 50 },
        },
        {
          op: "SET",
          path: { kind: "PREFERENCE", key: "efficiency" },
          value: { state: "VALUE", value: "IMPORTANT" },
        },
      ],
    },
  });
  const version = await intentStore.getVersion(scope.currentIntentVersionId);
  assert.ok(version);
  const snapshot = buildDecisionInputFromGeneralizedIntent(
    deriveGeneralizedDecisionIntentFromState(
      scope.intentScopeId,
      version.intentVersionId,
      version.state,
    ),
    catalog,
  );
  return { intentStore, scope, snapshot };
}

test("DecisionPlan accepts one exact authoritative decision projection", async () => {
  const { intentStore, scope, snapshot } = await exactPlanFixture();
  const plans = new MemoryDecisionPlanStore(intentStore);
  try {
    const plan = await plans.bind({
      decisionPlanId: decisionPlanIdForRun("run-exact"),
      runId: "run-exact",
      intentScopeId: scope.intentScopeId,
      intentVersionId: scope.currentIntentVersionId,
      planningMaterial: snapshot,
    });
    assert.deepEqual(plan.planningMaterial, snapshot);
  } finally {
    await plans.close();
    await intentStore.close();
  }
});

test("DecisionPlan rejects semantic mismatches despite matching ids and field counts", async () => {
  const { intentStore, scope, snapshot } = await exactPlanFixture();
  const plans = new MemoryDecisionPlanStore(intentStore);
  try {
    await assert.rejects(
      plans.bind({
        decisionPlanId: decisionPlanIdForRun("run-wrong-requirement"),
        runId: "run-wrong-requirement",
        intentScopeId: scope.intentScopeId,
        intentVersionId: scope.currentIntentVersionId,
        planningMaterial: {
          ...structuredClone(snapshot),
          hardRequirements: snapshot.hardRequirements.map((item) => ({ ...item, expected: 5 })),
        },
      }),
      /not the exact projection/,
    );

    await assert.rejects(
      plans.bind({
        decisionPlanId: decisionPlanIdForRun("run-wrong-preference"),
        runId: "run-wrong-preference",
        intentScopeId: scope.intentScopeId,
        intentVersionId: scope.currentIntentVersionId,
        planningMaterial: {
          ...structuredClone(snapshot),
          priorities: snapshot.priorities.map((item) => ({ ...item, tier: "NICE_TO_HAVE" as const })),
        },
      }),
      /not the exact projection/,
    );

    await assert.rejects(
      plans.bind({
        decisionPlanId: decisionPlanIdForRun("run-invented-binding"),
        runId: "run-invented-binding",
        intentScopeId: scope.intentScopeId,
        intentVersionId: scope.currentIntentVersionId,
        planningMaterial: {
          ...structuredClone(snapshot),
          criterionBindings: [
            ...snapshot.criterionBindings,
            { criterionId: "invented", criterionVersion: 1 },
          ],
        },
      }),
      /not the exact projection/,
    );
  } finally {
    await plans.close();
    await intentStore.close();
  }
});
