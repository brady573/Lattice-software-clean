import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MemoryIntentAuthorityStore, PostgresIntentAuthorityStore } from "../src/intent/index.js";
import {
  MemoryDecisionPlanStore,
  PostgresDecisionPlanStore,
  decisionPlanIdForRun,
} from "../src/intent/decision-plan-store.js";
import { createRuntimeApp, migrateRuntimeDatabase } from "../src/runtime-app.js";
import type { RuntimeConfig } from "../src/runtime-config.js";

const databaseUrl = process.env.DATABASE_URL;
const memoryConfig: RuntimeConfig = {
  port: 3000,
  host: "127.0.0.1",
  databaseUrl: undefined,
  deploymentMode: "development",
  truthMode: "v36-offline",
  autoMigrate: false,
  modelSimulatorBaseUrl: undefined,
  modelSimulatorModel: "offline-prototype",
  androidModelRelayToken: undefined,
  androidModelRelayModel: "android-local-prototype",
  androidModelRelayTimeoutMs: 45_000,
};

const clearContent = "I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.";

const boundedPlanningMaterial = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  priorities: [{ criterion: "performance", weight: 1 }],
  hardConstraints: [
    { criterion: "price", operator: "lte" as const, value: 1300 },
    { criterion: "batteryHours", operator: "gte" as const, value: 12 },
  ],
};

const boundedIntentOperations = [
  { op: "SET" as const, path: { kind: "OBJECTIVE" as const }, value: { state: "VALUE" as const, value: "choose a laptop" } },
  { op: "SET" as const, path: { kind: "REQUIREMENT" as const, key: "price.max.usd" }, value: { state: "VALUE" as const, value: 1300 } },
  { op: "SET" as const, path: { kind: "REQUIREMENT" as const, key: "batteryHours.min" }, value: { state: "VALUE" as const, value: 12 } },
  { op: "SET" as const, path: { kind: "PREFERENCE" as const, key: "performance.relativeToBattery" }, value: { state: "VALUE" as const, value: "MORE_IMPORTANT" } },
];

test("exact-bound runtime Run exposes its durable DecisionPlan envelope", async () => {
  const app = await createRuntimeApp(memoryConfig, { memoryDispatchDelayMs: 1_000 });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/scope-m7-e/clear-user-messages`,
      payload: { turnId: "turn-m7-e", messageId: "message-m7-e", content: clearContent },
    });
    assert.equal(accepted.statusCode, 202);
    const body = accepted.json<{ runId: string; intentScopeId: string; intentVersionId: string }>();

    const planResponse = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${body.runId}/decision-plan`,
    });
    assert.equal(planResponse.statusCode, 200);
    const plan = planResponse.json().decisionPlan;
    assert.equal(plan.decisionPlanId, decisionPlanIdForRun(body.runId));
    assert.equal(plan.runId, body.runId);
    assert.equal(plan.intentScopeId, body.intentScopeId);
    assert.equal(plan.intentVersionId, body.intentVersionId);
    assert.deepEqual(plan.planningMaterial.hardConstraints, boundedPlanningMaterial.hardConstraints);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/scope-m7-e/clear-user-messages`,
      payload: { turnId: "turn-m7-e", messageId: "message-m7-e", content: clearContent },
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, body.runId);
    const replayPlan = await app.inject({ method: "GET", url: `/api/v1/runs/${body.runId}/decision-plan` });
    assert.deepEqual(replayPlan.json().decisionPlan, plan);
  } finally {
    await app.close();
  }
});

test("DecisionPlan rejects planning material that contradicts its exact IntentVersion", async () => {
  const intentStore = new MemoryIntentAuthorityStore();
  const scopeId = "scope-m7-g1-mismatch";
  const scope = await intentStore.createScope({
    intentScopeId: scopeId,
    initialTransition: {
      transitionId: "transition-m7-g1-mismatch",
      intentScopeId: scopeId,
      baseIntentVersionId: null,
      logicalUserTurnId: "turn-m7-g1-mismatch",
      observedMessageHorizon: 1,
      sourceMessageId: "message-m7-g1-mismatch",
      sourceDigest: "b".repeat(64),
      operations: boundedIntentOperations,
    },
  });
  const planStore = new MemoryDecisionPlanStore(intentStore);
  try {
    await assert.rejects(
      planStore.bind({
        decisionPlanId: "decision-plan:m7-g1-mismatch",
        runId: "m7-g1-mismatch",
        intentScopeId: scopeId,
        intentVersionId: scope.currentIntentVersionId,
        planningMaterial: {
          ...boundedPlanningMaterial,
          hardConstraints: [
            { criterion: "price", operator: "lte", value: 900 },
            { criterion: "batteryHours", operator: "gte", value: 12 },
          ],
        },
      }),
      /not the qualified projection of its exact IntentVersion/,
    );
  } finally {
    await planStore.close();
    await intentStore.close();
  }
});

test("PostgreSQL DecisionPlan survives store restart with exact IntentVersion binding", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const scopeId = `scope-m7-g1-${randomUUID()}`;
  const runId = randomUUID();
  let versionId: string | undefined;

  try {
    const scope = await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: {
        transitionId: `transition-${randomUUID()}`,
        intentScopeId: scopeId,
        baseIntentVersionId: null,
        logicalUserTurnId: `turn-${randomUUID()}`,
        observedMessageHorizon: 1,
        sourceMessageId: `message-${randomUUID()}`,
        sourceDigest: "a".repeat(64),
        operations: boundedIntentOperations,
      },
    });
    versionId = scope.currentIntentVersionId;

    const first = await PostgresDecisionPlanStore.connect(databaseUrl, { migrate: false });
    const created = await first.bind({
      decisionPlanId: decisionPlanIdForRun(runId),
      runId,
      intentScopeId: scopeId,
      intentVersionId: versionId,
      planningMaterial: boundedPlanningMaterial,
    });
    await first.close();

    const reopened = await PostgresDecisionPlanStore.connect(databaseUrl, { migrate: false });
    const restored = await reopened.getByRunId(runId);
    assert.deepEqual(restored, created);
    await reopened.close();
  } finally {
    await intentStore.close();
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
