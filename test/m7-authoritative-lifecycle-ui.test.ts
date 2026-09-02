import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import type { FastifyInstance } from "fastify";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

const boundedUserTurn = "I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.";

async function waitForCompletedRun(app: FastifyInstance, runId: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const run = response.json<{ status: string }>();
    if (run.status === "COMPLETED") return;
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached unexpected terminal status ${run.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms.`);
}

test("authoritative Solandra baseline binds the composer to durable Product lifecycle and semantic presentation APIs", () => {
  const html = renderSolandraAuthoritativeConversationPage();

  assert.match(html, /What do you need to figure out\?/);
  assert.match(html, /id="resourceFocus"/);
  assert.match(html, /id="newUpdate"/);
  assert.match(html, /support-node/);
  assert.match(html, /\/api\/v1\/conversations/);
  assert.match(html, /\/clear-user-messages/);
  assert.match(html, /\/continuity/);
  assert.match(html, /\/events\/stream/);
  assert.match(html, /\/result/);
  assert.match(html, /\/presentation/);
  assert.match(html, /knownRevision/);
  assert.match(html, /event\.isComposing/);
  assert.match(html, /event\.shiftKey/);
  assert.doesNotMatch(html, /Knowledge Orbit|sunTitle|moonWhy|data-key="budget"|scrollIntoView/i);
  assert.doesNotMatch(html, /\/api\/v1\/prototype\/model-conversations\//);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
  assert.ok(scripts.length >= 1, "Expected canonical baseline browser script.");
  for (const source of scripts) new Script(source);
});

test("Product runtime serves the baseline and authoritative lifecycle composes into semantic presentation", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 5 });

  try {
    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200);
    assert.match(root.body, /What do you need to figure out\?/);
    assert.match(root.body, /id="resourceFocus"/);
    assert.match(root.body, /id="newUpdate"/);
    assert.doesNotMatch(root.body, /Knowledge Orbit|sunTitle|moonWhy/i);

    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const intentScopeId = "m7-g2b-ui-scope";
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${intentScopeId}/clear-user-messages`,
      payload: {
        turnId: "m7-g2b-ui-turn",
        messageId: "m7-g2b-ui-message",
        content: boundedUserTurn,
      },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const runId = accepted.json<{ runId: string; intentVersionId: string }>().runId;
    const intentVersionId = accepted.json<{ runId: string; intentVersionId: string }>().intentVersionId;

    const plan = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/decision-plan` });
    assert.equal(plan.statusCode, 200, plan.body);
    assert.equal(plan.json().decisionPlan.intentScopeId, intentScopeId);
    assert.equal(plan.json().decisionPlan.intentVersionId, intentVersionId);
    assert.equal(plan.json().decisionPlan.planningMaterial.hardConstraints[0].criterion, "price");

    const inProgressPresentation = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation`,
    });
    assert.equal(inProgressPresentation.statusCode, 200, inProgressPresentation.body);
    assert.notEqual(inProgressPresentation.json().presentation.phase, "actionable");
    assert.equal(inProgressPresentation.json().presentation.nextAction, undefined);

    await waitForCompletedRun(app, runId);

    const events = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/events` });
    assert.equal(events.statusCode, 200, events.body);
    assert.equal(events.json().events.at(-1).type, "COMPLETED");

    const result = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/result` });
    assert.equal(result.statusCode, 200, result.body);
    assert.match(result.json().explanation, /Nova Air/);

    const presentation = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/presentation`,
    });
    assert.equal(presentation.statusCode, 200, presentation.body);
    assert.equal(presentation.json().presentation.phase, "actionable");
    assert.equal(
      presentation.json().presentation.nextAction.winnerCandidateId,
      result.json().decision.winnerCandidateId,
    );
    assert.equal(presentation.json().presentation.durableUnderstanding.requirements[0].criterion, "price");
    assert.equal(presentation.json().presentation.durableUnderstanding.preferences[0].criterion, "performance");

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.equal(continuity.json().messages.length, 1);
    assert.equal(continuity.json().messages[0].content, boundedUserTurn);
    const historical = continuity.json().runs.find((run: { runId: string }) => run.runId === runId);
    assert.ok(historical);
    assert.equal(historical.status, "COMPLETED");
    assert.equal(historical.resultAvailable, true);
    assert.equal(historical.exactBinding.intentScopeId, intentScopeId);
    assert.equal(historical.exactBinding.intentVersionId, intentVersionId);
  } finally {
    await app.close();
  }
});
