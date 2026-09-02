import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryIntentAuthorityStore,
  bindDecisionPlanToExactIntentVersion,
} from "../src/intent/index.js";

function initialTransition(intentScopeId: string) {
  return {
    transitionId: "transition-plan-1",
    intentScopeId,
    baseIntentVersionId: null,
    logicalUserTurnId: "turn-plan-1",
    observedMessageHorizon: 1,
    sourceMessageId: "message-plan-1",
    sourceDigest: "digest-plan-1",
    operations: [
      {
        op: "SET" as const,
        path: { kind: "OBJECTIVE" as const },
        value: { state: "VALUE" as const, value: "choose a laptop" },
      },
    ],
  };
}

test("DecisionPlan binding preserves exact historical IntentVersion identity", async () => {
  const ids = ["intent-version-1", "intent-version-2"];
  const store = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected-id");
  const scope = await store.createScope({
    intentScopeId: "scope-plan",
    initialTransition: initialTransition("scope-plan"),
  });

  const planningMaterial = {
    objective: "choose a laptop",
    candidateSet: ["alpha", "beta"],
  };
  const bound = await bindDecisionPlanToExactIntentVersion(store, {
    decisionPlanId: "plan-1",
    intentScopeId: scope.intentScopeId,
    intentVersionId: scope.currentIntentVersionId,
    planningMaterial,
  });

  planningMaterial.candidateSet.push("mutated-after-bind");
  assert.equal(bound.intentScopeId, "scope-plan");
  assert.equal(bound.intentVersionId, "intent-version-1");
  assert.deepEqual(bound.planningMaterial, {
    objective: "choose a laptop",
    candidateSet: ["alpha", "beta"],
  });

  const advanced = await store.applyTransition({
    transitionId: "transition-plan-2",
    intentScopeId: "scope-plan",
    baseIntentVersionId: "intent-version-1",
    logicalUserTurnId: "turn-plan-2",
    observedMessageHorizon: 2,
    sourceMessageId: "message-plan-2",
    sourceDigest: "digest-plan-2",
    operations: [
      {
        op: "SET",
        path: { kind: "PREFERENCE", key: "budget" },
        value: { state: "VALUE", value: 1200 },
      },
    ],
  });

  assert.equal(advanced.disposition, "COMMITTED");
  assert.equal(advanced.resultingIntentVersionId, "intent-version-2");
  assert.equal(bound.intentVersionId, "intent-version-1");

  const rebound = await bindDecisionPlanToExactIntentVersion(store, {
    decisionPlanId: "plan-2",
    intentScopeId: "scope-plan",
    intentVersionId: "intent-version-2",
    planningMaterial: { objective: "choose a laptop", budget: 1200 },
  });
  assert.equal(rebound.intentVersionId, "intent-version-2");

  await store.close();
});

test("DecisionPlan binding fails closed on missing or cross-scope IntentVersion identity", async () => {
  const store = new MemoryIntentAuthorityStore(() => "intent-version-a");
  await store.createScope({
    intentScopeId: "scope-a",
    initialTransition: initialTransition("scope-a"),
  });

  await assert.rejects(
    () => bindDecisionPlanToExactIntentVersion(store, {
      decisionPlanId: "plan-missing",
      intentScopeId: "scope-a",
      intentVersionId: "missing-version",
      planningMaterial: {},
    }),
    /existing exact IntentVersion/,
  );

  await assert.rejects(
    () => bindDecisionPlanToExactIntentVersion(store, {
      decisionPlanId: "plan-cross-scope",
      intentScopeId: "scope-b",
      intentVersionId: "intent-version-a",
      planningMaterial: {},
    }),
    /existing exact IntentVersion/,
  );

  await store.close();
});
