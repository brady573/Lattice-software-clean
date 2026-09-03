import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { buildLegacyTestApp as buildApp } from "../src/legacy/legacy-test-app.js";
import type { RunRequest } from "../src/domain.js";
import {
  createLegacyDecisionTruthComposition,
  laptopFixture,
} from "./fixtures/legacy-laptop-fixture.js";
import { createFixtureDecisionEvidenceProvider } from "../src/truth/decision-evidence-provider.js";
import { createPendingRun, executePersistedRun } from "../src/run-execution.js";
import { MemoryRunStore } from "../src/run-store.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  DECISION_MESSAGE,
  FoundationalConsultationInterpreter,
  createFoundationalTruthComposition,
  foundationalCriterionCatalog,
} from "./fixtures/foundational-consultation-fixture.js";
import {
  OfflineFixtureTruthPipeline,
  type TruthExecutionPipeline,
} from "../src/truth/execution-pipeline.js";

const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

async function waitForCompletedRun(
  app: FastifyInstance,
  runId: string,
  timeoutMs = 2_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200);
    const run = response.json<Record<string, unknown>>();
    if (run.status === "COMPLETED") return run;
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached unexpected terminal status ${String(run.status)}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms.`);
}

test("concurrent identical API submissions converge while changed-body key reuse conflicts", async () => {
  const store = new MemoryRunStore();
  const app = buildApp({ runStore: store });
  try {
    const submit = () => app.inject({
      method: "POST",
      url: "/api/v1/conversations/idempotent-demo/messages",
      headers: { "idempotency-key": "same-request" },
      payload: request,
    });
    const [first, second] = await Promise.all([submit(), submit()]);
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.equal(first.json().runId, second.json().runId);
    assert.equal(first.json().status, "CREATED");

    const conflicting = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/idempotent-demo/messages",
      headers: { "idempotency-key": "same-request" },
      payload: { ...request, goal: `${request.goal} changed` },
    });
    assert.equal(conflicting.statusCode, 409);
    assert.equal(conflicting.json().error, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY");
  } finally {
    await app.close();
  }
});

test("runtime completes an accepted in-memory asynchronous Run and exposes its Decision Support outcome", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 5,
    ...createFoundationalTruthComposition(),
    consultationInterpreter: new FoundationalConsultationInterpreter(),
    criterionCatalog: foundationalCriterionCatalog,
  });
  try {
    const createdConversation = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(createdConversation.statusCode, 201);
    const conversationId = createdConversation.json<{ conversation: { id: string } }>().conversation.id;

    const pending = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "async-decision-turn", message: DECISION_MESSAGE },
    });
    assert.equal(pending.statusCode, 202);
    assert.equal(pending.json().status, "NEEDS_CLARIFICATION");
    const submit = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/clarifications/${pending.json().proposalId}/confirm`,
      payload: { turnId: "async-decision-confirm", message: "Yes, that's correct." },
    });
    assert.equal(submit.statusCode, 202);
    assert.equal(submit.json().status, "RUN_ACCEPTED");
    const runId = submit.json().runId as string;

    const completed = await waitForCompletedRun(app, runId);
    assert.equal(completed.status, "COMPLETED");

    const events = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/events` });
    assert.equal(events.statusCode, 200);
    assert.deepEqual(
      events.json().events.map((event: { type: string }) => event.type),
      ["CREATED", "UNDERSTANDING", "PLANNING", "INVESTIGATING", "VALIDATING", "DECIDING", "EXPLAINING", "COMPLETED"],
    );

    const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.equal(outcome.statusCode, 200);
    assert.equal(outcome.json().status, "COMPLETED");
    assert.equal(outcome.json().outcome.kind, "DECISION_SUPPORT");
    assert.equal(outcome.json().outcome.decision.winnerCandidateId, "cedar");
    assert.match(outcome.json().outcome.explanation, /Cedar/i);
  } finally {
    await app.close();
  }
});

test("automatic in-memory asynchronous execution preserves immediate cancellation", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 25 });
  try {
    const createdConversation = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(createdConversation.statusCode, 201);
    const conversationId = createdConversation.json<{ conversation: { id: string } }>().conversation.id;

    const submit = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "cancel-knowledge-turn", message: "Explain how volcanic islands form." },
    });
    assert.equal(submit.statusCode, 202);
    const runId = submit.json().runId as string;

    const cancel = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/cancel` });
    assert.equal(cancel.statusCode, 202);
    assert.equal(cancel.json().status, "CANCELLED");

    await new Promise((resolve) => setTimeout(resolve, 50));
    const current = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(current.statusCode, 200);
    assert.equal(current.json().status, "CANCELLED");
    assert.deepEqual(
      current.json().events.map((event: { type: string }) => event.type),
      ["CREATED", "CANCELLED"],
    );
  } finally {
    await app.close();
  }
});

test("cancellation is durable and prevents later worker execution from mutating the Run", async () => {
  const store = new MemoryRunStore();
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const app = buildApp({
    runStore: store,
    truthPipeline: pipeline,
    decisionEvidenceProvider: createLegacyDecisionTruthComposition().decisionEvidenceProvider,
  });
  try {
    const submit = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/cancel-demo/messages",
      payload: request,
    });
    const runId = submit.json().runId as string;
    const cancel = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/cancel` });
    assert.equal(cancel.statusCode, 202);
    assert.equal(cancel.json().status, "CANCELLED");

    const repeated = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/cancel` });
    assert.equal(repeated.statusCode, 202);
    assert.equal(repeated.json().status, "CANCELLED");

    const executed = await executePersistedRun(store, pipeline, runId);
    assert.equal(executed.status, "CANCELLED");
    assert.equal(executed.version, 2);
    assert.deepEqual(executed.events.map((event) => event.type), ["CREATED", "CANCELLED"]);

    const result = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/result` });
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().status, "CANCELLED");
  } finally {
    await app.close();
  }
});

test("worker resumes DECIDING from persisted V36 state without re-running investigation or validation", async () => {
  const store = new MemoryRunStore();
  const base = new OfflineFixtureTruthPipeline(laptopFixture);
  const run = createPendingRun("resume-demo", request, "00000000-0000-4000-8000-000000006006");
  await store.create(run);
  assert.deepEqual(await store.transition({ runId: run.id, expectedStatus: "CREATED", expectedVersion: 1, nextStatus: "UNDERSTANDING" }), { outcome: "advanced", version: 2 });
  assert.deepEqual(await store.transition({ runId: run.id, expectedStatus: "UNDERSTANDING", expectedVersion: 2, nextStatus: "PLANNING" }), { outcome: "advanced", version: 3 });
  assert.deepEqual(await store.transition({ runId: run.id, expectedStatus: "PLANNING", expectedVersion: 3, nextStatus: "INVESTIGATING" }), { outcome: "advanced", version: 4 });
  const investigation = await base.investigate(run.id);
  assert.deepEqual(await store.transition({ runId: run.id, expectedStatus: "INVESTIGATING", expectedVersion: 4, nextStatus: "VALIDATING", truthSnapshot: investigation.snapshot }), { outcome: "advanced", version: 5 });
  const validated = await base.validate(investigation.snapshot);
  assert.deepEqual(await store.transition({ runId: run.id, expectedStatus: "VALIDATING", expectedVersion: 5, nextStatus: "DECIDING", truthSnapshot: validated.snapshot }), { outcome: "advanced", version: 6 });

  const replayOnly: TruthExecutionPipeline = {
    mode: "v36-offline-fixture",
    investigate: async () => { throw new Error("investigate must not be re-run after DECIDING"); },
    validate: async () => { throw new Error("validate must not be re-run after DECIDING"); },
    execute: async () => { throw new Error("execute must not be used by durable resume"); },
  };

  const completed = await executePersistedRun(
    store,
    replayOnly,
    run.id,
    undefined,
    undefined,
    createFixtureDecisionEvidenceProvider(laptopFixture, (id) => base.ownsExecutionContract(id)),
  );
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.version, 8);
  assert.equal(completed.decision?.winnerCandidateId, "nova-air");
  assert.match(completed.explanation ?? "", /Nova Air/);
  await store.close();
});
