import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  createStandaloneResearchWorker,
  type StandaloneResearchWorker,
} from "../src/research-worker-process.js";
import {
  createStandaloneRunWorker,
  type StandaloneRunWorker,
} from "../src/run-worker-process.js";

const databaseUrl = process.env.DATABASE_URL;
const durableTestSubjectResolver = () => ({ subjectId: "m7-durable-reconnect-subject" });
const initialContent = "I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.";
const continuationContent = "I need a laptop under $1,100 with at least 12 hours of battery life as a hard requirement. Performance matters more.";

function durableRuntimeConfig(connectionString: string, autoMigrate: boolean) {
  return resolveRuntimeConfig({
    DATABASE_URL: connectionString,
    LATTICE_DEPLOYMENT_MODE: "durable",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: autoMigrate ? "true" : "false",
  } as NodeJS.ProcessEnv);
}

async function waitForCompletedRun(app: FastifyInstance, runId: string, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200);
    const run = response.json<{ status: string }>();
    if (run.status === "COMPLETED") return;
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached unexpected terminal status ${run.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms.`);
}

test(
  "M7 PostgreSQL conversation reconnect preserves exact binding, result, SSE replay, exact USER-turn replay, and later continuation",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const firstScopeId = `scope-m7-g2a-first-${randomUUID()}`;
    const secondScopeId = `scope-m7-g2a-next-${randomUUID()}`;
    const firstTurnId = randomUUID();
    const firstMessageId = randomUUID();
    const secondTurnId = randomUUID();
    const secondMessageId = randomUUID();
    const pool = new Pool({ connectionString: databaseUrl });

    let createdConversationId = "";
    let firstApp: FastifyInstance | undefined;
    let executionApp: FastifyInstance | undefined;
    let reopenedApp: FastifyInstance | undefined;
    let runWorker: StandaloneRunWorker | undefined;
    let researchWorker: StandaloneResearchWorker | undefined;
    let firstRunId = "";
    let firstIntentVersionId = "";
    let firstDecisionPlanId = "";
    let secondRunId = "";

    try {
      firstApp = await createRuntimeApp(durableRuntimeConfig(databaseUrl, true), {
        authenticatedSubjectResolver: durableTestSubjectResolver,
      });

      const created = await firstApp.inject({ method: "POST", url: "/api/v1/conversations" });
      assert.equal(created.statusCode, 201);
      createdConversationId = created.json<{ conversation: { id: string } }>().conversation.id;
      assert.ok(createdConversationId);

      const firstTurn = await firstApp.inject({
        method: "POST",
        url: `/api/v1/conversations/${createdConversationId}/intent-scopes/${firstScopeId}/clear-user-messages`,
        payload: { turnId: firstTurnId, messageId: firstMessageId, content: initialContent },
      });
      assert.equal(firstTurn.statusCode, 202);
      const accepted = firstTurn.json<{ runId: string; intentScopeId: string; intentVersionId: string }>();
      firstRunId = accepted.runId;
      firstIntentVersionId = accepted.intentVersionId;
      assert.equal(accepted.intentScopeId, firstScopeId);

      const firstPlan = await firstApp.inject({
        method: "GET",
        url: `/api/v1/runs/${firstRunId}/decision-plan`,
      });
      assert.equal(firstPlan.statusCode, 200);
      const firstPlanBody = firstPlan.json<{
        decisionPlan: {
          decisionPlanId: string;
          intentScopeId: string;
          intentVersionId: string;
        };
      }>().decisionPlan;
      firstDecisionPlanId = firstPlanBody.decisionPlanId;
      assert.equal(firstPlanBody.intentScopeId, firstScopeId);
      assert.equal(firstPlanBody.intentVersionId, firstIntentVersionId);

      const initialEvents = await firstApp.inject({ method: "GET", url: `/api/v1/runs/${firstRunId}/events` });
      assert.equal(initialEvents.statusCode, 200);
      assert.deepEqual(
        initialEvents.json().events.map((event: { sequence: number; type: string }) => [event.sequence, event.type]),
        [[1, "CREATED"]],
      );

      await firstApp.close();
      firstApp = undefined;

      executionApp = await createRuntimeApp(durableRuntimeConfig(databaseUrl, false), {
        authenticatedSubjectResolver: durableTestSubjectResolver,
      });
      researchWorker = await createStandaloneResearchWorker({
        databaseUrl,
        workerId: `m7-g2a-research:${randomUUID()}`,
        pollMs: 5,
        leaseMs: 30_000,
        retryDelayMs: 1_000,
        batchSize: 10,
      });
      runWorker = await createStandaloneRunWorker({
        databaseUrl,
        workerId: `m7-g2a-run:${randomUUID()}`,
        pollMs: 5,
        leaseMs: 30_000,
        retryDelayMs: 1_000,
        batchSize: 10,
      });
      researchWorker.start();
      runWorker.start();

      await waitForCompletedRun(executionApp, firstRunId);
      await runWorker.close();
      runWorker = undefined;
      await researchWorker.close();
      researchWorker = undefined;
      await executionApp.close();
      executionApp = undefined;

      reopenedApp = await createRuntimeApp(durableRuntimeConfig(databaseUrl, false), {
        authenticatedSubjectResolver: durableTestSubjectResolver,
      });
      const address = await reopenedApp.listen({ host: "127.0.0.1", port: 0 });

      const replayedTurn = await reopenedApp.inject({
        method: "POST",
        url: `/api/v1/conversations/${createdConversationId}/intent-scopes/${firstScopeId}/clear-user-messages`,
        payload: { turnId: firstTurnId, messageId: firstMessageId, content: initialContent },
      });
      assert.equal(replayedTurn.statusCode, 202);
      const replayed = replayedTurn.json<{ runId: string; intentVersionId: string }>();
      assert.equal(replayed.runId, firstRunId);
      assert.equal(replayed.intentVersionId, firstIntentVersionId);

      const messages = await reopenedApp.inject({
        method: "GET",
        url: `/api/v1/conversations/${createdConversationId}/messages`,
      });
      assert.equal(messages.statusCode, 200);
      assert.equal(messages.json().messages.length, 1);
      assert.equal(messages.json().messages[0].id, firstMessageId);
      assert.equal(messages.json().messages[0].content, initialContent);

      const continuity = await reopenedApp.inject({
        method: "GET",
        url: `/api/v1/conversations/${createdConversationId}/continuity`,
      });
      assert.equal(continuity.statusCode, 200);
      const continuityBody = continuity.json();
      const historical = continuityBody.runs.find((run: { runId: string }) => run.runId === firstRunId);
      assert.ok(historical);
      assert.equal(historical.status, "COMPLETED");
      assert.equal(historical.resultAvailable, true);
      assert.equal(historical.exactBinding.decisionPlanId, firstDecisionPlanId);
      assert.equal(historical.exactBinding.intentScopeId, firstScopeId);
      assert.equal(historical.exactBinding.intentVersionId, firstIntentVersionId);

      const result = await reopenedApp.inject({ method: "GET", url: `/api/v1/runs/${firstRunId}/result` });
      assert.equal(result.statusCode, 200);
      assert.equal(result.json().runId, firstRunId);
      assert.equal(result.json().status, "COMPLETED");

      const resumed = await fetch(`${address}/api/v1/runs/${firstRunId}/events/stream`, {
        headers: { "Last-Event-ID": "1" },
      });
      assert.equal(resumed.status, 200);
      const resumedBody = await resumed.text();
      assert.doesNotMatch(resumedBody, /id: 1\n/);
      assert.match(resumedBody, /id: 2\nevent: run-progress/);
      assert.match(resumedBody, /event: run-progress\ndata: .*"type":"COMPLETED"/);

      const secondTurn = await reopenedApp.inject({
        method: "POST",
        url: `/api/v1/conversations/${createdConversationId}/intent-scopes/${secondScopeId}/clear-user-messages`,
        payload: { turnId: secondTurnId, messageId: secondMessageId, content: continuationContent },
      });
      assert.equal(secondTurn.statusCode, 202);
      const continued = secondTurn.json<{ runId: string; intentVersionId: string }>();
      secondRunId = continued.runId;
      assert.notEqual(secondRunId, firstRunId);
      assert.notEqual(continued.intentVersionId, firstIntentVersionId);

      const afterContinuation = await reopenedApp.inject({
        method: "GET",
        url: `/api/v1/conversations/${createdConversationId}/continuity`,
      });
      assert.equal(afterContinuation.statusCode, 200);
      const afterBody = afterContinuation.json();
      assert.equal(afterBody.messages.length, 2);
      const historicalAfter = afterBody.runs.find((run: { runId: string }) => run.runId === firstRunId);
      assert.ok(historicalAfter);
      assert.equal(historicalAfter.status, "COMPLETED");
      assert.equal(historicalAfter.exactBinding.decisionPlanId, firstDecisionPlanId);
      assert.equal(historicalAfter.exactBinding.intentScopeId, firstScopeId);
      assert.equal(historicalAfter.exactBinding.intentVersionId, firstIntentVersionId);
    } finally {
      if (runWorker) await runWorker.close();
      if (researchWorker) await researchWorker.close();
      if (firstApp) await firstApp.close();
      if (executionApp) await executionApp.close();
      if (reopenedApp) await reopenedApp.close();

      const runIds = [firstRunId, secondRunId].filter(Boolean);
      if (runIds.length > 0) {
        await pool.query("DELETE FROM decision_plans WHERE run_id = ANY($1::text[])", [runIds]);
        // runs.id is UUID; dependent run rows cascade from the authoritative Run root.
        await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [runIds]);
      }
      await pool.query("DELETE FROM intent_user_messages WHERE intent_scope_id = ANY($1::text[])", [[firstScopeId, secondScopeId]]);
      await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id = ANY($1::text[])", [[firstScopeId, secondScopeId]]);
      if (createdConversationId) {
        await pool.query("DELETE FROM conversations WHERE id=$1", [createdConversationId]);
      }
      await pool.end();
    }
  },
);
