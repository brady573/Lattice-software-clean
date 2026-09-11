import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type { TruthExecutionPipeline } from "../src/truth/execution-pipeline.js";

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitKnowledgeRun(app: Awaited<ReturnType<typeof createRuntimeApp>>, turnId: string): Promise<void> {
  const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(created.statusCode, 201, created.body);
  const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
  const submitted = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId, message: "Explain how volcanic islands form." },
  });
  assert.equal(submitted.statusCode, 202, submitted.body);
  assert.equal(submitted.json<{ status: string }>().status, "RUN_ACCEPTED");
}

test("Issue #51: close cancels unstarted delayed in-memory dispatch instead of waiting for its timer", async () => {
  let investigations = 0;
  const pipeline: TruthExecutionPipeline = {
    mode: "v36-offline-fixture",
    investigate: async () => {
      investigations += 1;
      throw new Error("delayed execution must not start after close");
    },
    validate: async () => { throw new Error("validate must not run"); },
    execute: async () => { throw new Error("execute must not run"); },
  };
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 5_000,
    truthPipeline: pipeline,
  });

  await submitKnowledgeRun(app, "issue-51-delayed-close");

  const closeOutcome = await Promise.race([
    app.close().then(() => "closed" as const),
    sleep(250).then(() => "timed-out" as const),
  ]);
  assert.equal(closeOutcome, "closed");
  await sleep(50);
  assert.equal(investigations, 0);
});

test("Issue #51: close still drains in-memory execution that already started", async () => {
  let markStarted!: () => void;
  let releaseInvestigation!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseInvestigation = resolve; });
  const pipeline: TruthExecutionPipeline = {
    mode: "v36-offline-fixture",
    investigate: async () => {
      markStarted();
      await release;
      throw new Error("fixture terminal after release");
    },
    validate: async () => { throw new Error("validate must not run"); },
    execute: async () => { throw new Error("execute must not run"); },
  };
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 0,
    truthPipeline: pipeline,
  });

  await submitKnowledgeRun(app, "issue-51-started-close");
  await started;

  let closed = false;
  const closing = app.close().then(() => { closed = true; });
  await sleep(25);
  assert.equal(closed, false, "close must drain execution that crossed the dispatch boundary before shutdown");

  releaseInvestigation();
  await closing;
  assert.equal(closed, true);
});
