import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import type { FastifyInstance } from "fastify";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

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

test("authoritative Solandra surface is Conversation + free-form input + adaptive Composer", () => {
  const html = renderSolandraAuthoritativeConversationPage();

  assert.match(html, /What do you need to figure out\?/);
  assert.match(html, /id="conversation"/);
  assert.match(html, /id="conversationInput"/);
  assert.match(html, /id="composer"/);
  assert.match(html, /\/api\/v1\/conversations/);
  assert.match(html, /\/turns/);
  assert.match(html, /\/outcome/);
  assert.match(html, /event\.isComposing/);
  assert.match(html, /event\.shiftKey/);
  assert.doesNotMatch(html, /clear-user-messages|decision-plan|winnerCandidateId|Knowledge Orbit|resourceFocus|newUpdate/i);
  assert.doesNotMatch(html, /Atlas Pro|Nova Air|Forge 15|batteryHours|price\.max\.usd|performance\.relativeToBattery/i);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
  assert.ok(scripts.length >= 1, "Expected canonical Conversation browser script.");
  for (const source of scripts) new Script(source);
});

test("Product runtime accepts ordinary USER text and completes knowledge without DECIDING", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 5 });

  try {
    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200);
    assert.match(root.body, /id="conversationInput"/);
    assert.match(root.body, /id="composer"/);

    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const userText = "Explain the tradeoffs of keeping a local-first hobby app simple while preserving recoverability.";

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "foundational-knowledge-turn", message: userText },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const acceptedBody = accepted.json<{
      runId: string;
      acceptedUnderstanding: string;
      provenance: { origin: string; contentDigest: string; intentVersion: number };
    }>();
    assert.equal(acceptedBody.acceptedUnderstanding, userText);
    assert.equal(acceptedBody.provenance.origin, "USER");
    assert.match(acceptedBody.provenance.contentDigest, /^[a-f0-9]{64}$/u);
    assert.equal(acceptedBody.provenance.intentVersion, 1);

    await waitForCompletedRun(app, acceptedBody.runId);

    const runResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${acceptedBody.runId}` });
    assert.equal(runResponse.statusCode, 200, runResponse.body);
    const run = runResponse.json<{ status: string; events: Array<{ type: string }>; decision: unknown }>();
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.decision, null);
    assert.equal(run.events.some((event) => event.type === "DECIDING"), false);
    assert.deepEqual(run.events.map((event) => event.type), [
      "CREATED",
      "UNDERSTANDING",
      "PLANNING",
      "INVESTIGATING",
      "VALIDATING",
      "COMPLETED",
    ]);

    const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${acceptedBody.runId}/outcome` });
    assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
    const outcome = outcomeResponse.json().outcome;
    assert.equal(outcome.kind, "KNOWLEDGE");
    assert.equal(outcome.acceptedUnderstanding, userText);
    assert.deepEqual(outcome.findings, []);
    assert.match(outcome.uncertainties[0], /No validated external findings/);
    assert.equal("decision" in outcome, false);

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.equal(continuity.json().messages.length, 1);
    assert.equal(continuity.json().messages[0].content, userText);
  } finally {
    await app.close();
  }
});

test("prepared resources remain editable material rather than execution authorization", async () => {
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 5 });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "foundational-resource-turn",
        message: "Prepare a checklist for reviewing a risky configuration change before I apply it.",
        prepare: "CHECKLIST",
      },
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const runId = accepted.json<{ runId: string }>().runId;
    await waitForCompletedRun(app, runId);

    const result = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().outcome.kind, "ACTION_PREPARATION");
    assert.equal(result.json().outcome.resource.kind, "CHECKLIST");
    assert.equal(result.json().outcome.resource.editable, true);
    assert.equal(result.json().outcome.resource.executionAuthorized, false);
  } finally {
    await app.close();
  }
});
