import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraConversationPage } from "../src/ui/solandra-conversation-page.js";

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

async function createConversation(app: Awaited<ReturnType<typeof createRuntimeApp>>, headers?: Record<string, string>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/conversations",
    ...(headers ? { headers } : {}),
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function submitTurn(
  app: Awaited<ReturnType<typeof createRuntimeApp>>,
  conversationId: string,
  turnId: string,
  message: string,
  headers?: Record<string, string>,
) {
  return await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`,
    ...(headers ? { headers } : {}),
    payload: { turnId, message },
  });
}

test("canonical Solandra recovery keeps browser state non-authoritative and exposes only ordinary recovery controls", () => {
  const html = renderSolandraConversationPage();

  assert.match(html, /id="stopButton"[^>]*hidden>Stop<\/button>/u);
  assert.match(html, /lattice\.solandra\.conversation\.v1/u);
  assert.match(html, /lattice\.solandra\.pending-turn\.v1/u);
  assert.match(html, /lattice\.solandra\.active-work\.v1/u);
  assert.match(html, /lattice\.solandra\.draft\.v1/u);
  assert.match(html, /storePendingTurn\(record\);[\s\S]*postTurnRecord\(record\)/u);
  assert.match(html, /body: JSON\.stringify\(\{ turnId: record\.turnId, message: record\.message \}\)/u);
  assert.match(html, /\/continuity/u);
  assert.match(html, /\/presentation\/resources\//u);
  assert.match(html, /hydrated\?\.descriptor\?\.editable !== true/u);
  assert.match(html, /hydrated\?\.descriptor\?\.executionAuthorized !== false/u);
  assert.match(html, /\/cancel/u);
  assert.match(html, /I stopped that work\. Your last trustworthy result is still here\./u);
  assert.doesNotMatch(html, /RUN_NOT_SUCCESSFUL/u);
  assert.doesNotMatch(html, /worker status|queue status|provider status|retry epoch/iu);
});

test("one logical USER turn identity replays to one durable USER message and one Run", async () => {
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 250 });
  try {
    const conversationId = await createConversation(app);
    const turnId = "a5-uncertain-logical-turn";
    const message = "Investigate the current question without changing my objective.";

    const first = await submitTurn(app, conversationId, turnId, message);
    assert.equal(first.statusCode, 202, first.body);
    const firstBody = first.json<{ runId: string; intentVersionId: string; provenance: { messageId: string } }>();

    // Simulate transport uncertainty: the browser cannot trust the first response and
    // resubmits the exact persisted logical turn identity instead of minting a new one.
    const replay = await submitTurn(app, conversationId, turnId, message);
    assert.equal(replay.statusCode, 202, replay.body);
    const replayBody = replay.json<{ runId: string; intentVersionId: string; provenance: { messageId: string } }>();

    assert.equal(replayBody.runId, firstBody.runId);
    assert.equal(replayBody.intentVersionId, firstBody.intentVersionId);
    assert.equal(replayBody.provenance.messageId, firstBody.provenance.messageId);

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    const body = continuity.json<{ messages: Array<{ id: string }>; runs: Array<{ runId: string }> }>();
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0]?.id, firstBody.provenance.messageId);
    assert.equal(body.runs.length, 1);
    assert.equal(body.runs[0]?.runId, firstBody.runId);
  } finally {
    await app.close();
  }
});

test("existing cancellation boundary remains authoritative after deferred execution wakes", async () => {
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 180 });
  try {
    const conversationId = await createConversation(app);
    const submitted = await submitTurn(
      app,
      conversationId,
      "a5-stop-logical-turn",
      "Investigate this question so I can decide whether to continue.",
    );
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${encodeURIComponent(runId)}/cancel`,
    });
    assert.equal(cancelled.statusCode, 202, cancelled.body);
    assert.equal(cancelled.json<{ status: string }>().status, "CANCELLED");

    await new Promise((resolve) => setTimeout(resolve, 260));
    const observed = await app.inject({ method: "GET", url: `/api/v1/runs/${encodeURIComponent(runId)}` });
    assert.equal(observed.statusCode, 200, observed.body);
    assert.equal(observed.json<{ status: string }>().status, "CANCELLED");
  } finally {
    await app.close();
  }
});

test("a different authenticated subject cannot recover, inspect, or cancel another subject's consultation", async () => {
  const subjectResolver = (request: FastifyRequest) => {
    const value = request.headers["x-a5-subject"];
    return typeof value === "string" && value.trim() ? { subjectId: value } : undefined;
  };
  const app = await createRuntimeApp(
    resolveRuntimeConfig({
      LATTICE_DEPLOYMENT_MODE: "development",
      LATTICE_TRUTH_MODE: "v36-offline",
      LATTICE_AUTHENTICATION_MODE: "required",
    } as NodeJS.ProcessEnv),
    { authenticatedSubjectResolver: subjectResolver, memoryDispatchDelayMs: 250 },
  );
  const owner = { "x-a5-subject": "a5-owner" };
  const other = { "x-a5-subject": "a5-other" };
  try {
    const conversationId = await createConversation(app, owner);
    const submitted = await submitTurn(
      app,
      conversationId,
      "a5-owned-turn",
      "Investigate this owned consultation.",
      owner,
    );
    assert.equal(submitted.statusCode, 202, submitted.body);
    const runId = submitted.json<{ runId: string }>().runId;

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity`,
      headers: other,
    });
    assert.equal(continuity.statusCode, 404);

    const run = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${encodeURIComponent(runId)}`,
      headers: other,
    });
    assert.equal(run.statusCode, 404);

    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${encodeURIComponent(runId)}/cancel`,
      headers: other,
    });
    assert.equal(cancel.statusCode, 404);
  } finally {
    await app.close();
  }
});
