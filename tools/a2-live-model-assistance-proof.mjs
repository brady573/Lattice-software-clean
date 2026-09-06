import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerModelAssistanceApi } from "../dist/src/model-assistance-api.js";
import { createConfiguredModelAssistanceCapability } from "../dist/src/model-assistance-composition.js";
import { createRuntimeApp } from "../dist/src/runtime-app.js";
import { resolveRuntimeConfig } from "../dist/src/runtime-config.js";

const original = "C4 photosynthesis spatially separates initial carbon fixation from the Calvin cycle, which may reduce photorespiration under hot, dry conditions.";
const config = resolveRuntimeConfig({
  ...process.env,
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_KNOWLEDGE_SIMPLIFIER_ROUTE: "groq-gpt-oss-120b",
});

const sourceProvider = {
  kind: "a2-live-proof-source",
  async acquire() {
    return {
      sources: [{
        sourceId: "a2-live-c4",
        canonicalUri: "https://knowledge.example/a2-live-c4",
        title: "A2 live C4 source",
        publisher: "A2 qualification fixture",
        retrievedAt: new Date().toISOString(),
        publishedAt: null,
        contentType: "text/plain",
        content: original,
      }],
      claims: [{
        claimId: "a2-live-c4-report",
        text: original,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "a2-live-c4", relation: "SUPPORTS", excerpt: original }],
      }],
    };
  },
};

async function request(app, options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json();
}

async function waitForOutcome(app, runId) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${run.status}.`);
    if (run.status === "COMPLETED") {
      return await request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("A2 live Product run did not complete.");
}

async function turn(app, conversationId, message) {
  const accepted = await request(app, {
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(accepted.status, "RUN_ACCEPTED");
  const envelope = await waitForOutcome(app, accepted.runId);
  return { accepted, ...envelope };
}

const service = await createConfiguredModelAssistanceCapability(config);
const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  knowledgeAcquisitionProvider: sourceProvider,
  modelAssistanceService: service,
});
registerModelAssistanceApi(app, service);

try {
  const root = await app.inject({ method: "GET", url: "/" });
  assert.equal(root.statusCode, 200, root.body);
  assert.match(root.body, /Model assistance/u);

  const initialCapability = (await request(app, {
    method: "GET",
    url: "/api/v1/capabilities/model-assistance",
  })).capability;
  assert.equal(initialCapability.status, "DISCONNECTED");
  assert.equal(initialCapability.lastInvocation, null);

  const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
  const conversationId = created.conversation.id;
  const initial = await turn(app, conversationId, "Explain C4 photosynthesis.");
  assert.equal(initial.outcome.findings[0]?.text, original);

  const blocked = await turn(app, conversationId, "Put that in plain language.");
  assert.match(blocked.presentation.assistantMessage, /Model assistance isn't connected/iu);
  const beforeConnect = (await request(app, {
    method: "GET",
    url: "/api/v1/capabilities/model-assistance",
  })).capability;
  assert.equal(beforeConnect.lastInvocation, null);

  const connected = (await request(app, {
    method: "POST",
    url: "/api/v1/capabilities/model-assistance/connect",
  })).capability;
  assert.equal(connected.status, "CONNECTED");
  assert.equal(connected.authorized, true);

  const assisted = await turn(app, conversationId, "Put that in plain language.");
  assert.equal(assisted.outcome.findings[0]?.text, original);
  assert.notEqual(assisted.presentation.assistantMessage, blocked.presentation.assistantMessage);
  assert.doesNotMatch(assisted.presentation.assistantMessage, /Groq|gpt-oss|provider|model ID/iu);

  const afterUse = (await request(app, {
    method: "GET",
    url: "/api/v1/capabilities/model-assistance",
  })).capability;
  assert.equal(afterUse.lastInvocation?.outcome, "SUCCEEDED");
  assert.equal(afterUse.lastInvocation?.runId, assisted.accepted.runId);
  assert.equal(afterUse.lastInvocation?.provenance?.actualProvider, "groq");
  assert.equal(afterUse.lastInvocation?.provenance?.actualModel, "openai/gpt-oss-120b");
  assert.equal(afterUse.lastInvocation?.provenance?.routeProvenance, "COMPLETE");
  assert.ok(afterUse.lastInvocation?.provenance?.upstreamRequestId);

  const disconnected = (await request(app, {
    method: "DELETE",
    url: "/api/v1/capabilities/model-assistance/connect",
  })).capability;
  assert.equal(disconnected.status, "DISCONNECTED");
  assert.equal(disconnected.authorized, false);

  const afterDisconnect = await turn(app, conversationId, "Put that in plain language.");
  assert.match(afterDisconnect.presentation.assistantMessage, /Model assistance isn't connected/iu);
  const finalCapability = (await request(app, {
    method: "GET",
    url: "/api/v1/capabilities/model-assistance",
  })).capability;
  assert.equal(finalCapability.status, "DISCONNECTED");
  assert.equal(finalCapability.lastInvocation?.runId, assisted.accepted.runId);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    capability: "plain-language-model-assistance",
    authorization: {
      initial: initialCapability.status,
      connected: connected.status,
      final: finalCapability.status,
    },
    productPath: {
      objective: initial.accepted.acceptedUnderstanding,
      blockedBeforeAuthorization: true,
      canonicalFindingPreserved: assisted.outcome.findings[0]?.text === original,
      assistantMessage: assisted.presentation.assistantMessage,
      postRevocationBlocked: true,
    },
    invocation: afterUse.lastInvocation,
  }, null, 2)}\n`);
} finally {
  await app.close();
  await service.close();
}
