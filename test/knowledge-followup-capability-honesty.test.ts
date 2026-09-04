import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { WikimediaKnowledgeAcquisitionProvider } from "../src/knowledge/wikimedia-acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const fixedTime = "2026-09-04T18:00:00.000Z";

function wikimediaFixture(observed: URL[], extract: string): typeof fetch {
  return async (input) => {
    observed.push(new URL(String(input)));
    return new Response(JSON.stringify({
      query: {
        pages: [{
          pageid: 42,
          index: 1,
          title: "Retrieved topic",
          fullurl: "https://en.wikipedia.org/wiki/Retrieved_topic",
          touched: "2026-09-01T00:00:00.000Z",
          extract,
        }],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

class StableRecordingProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "stable-recording-source";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    const text = "The retrieved source reports a stable source-grounded statement.";
    return {
      sources: [{
        sourceId: "source-a",
        canonicalUri: "https://knowledge.example/source-a",
        title: "Source A",
        publisher: "Knowledge Example",
        retrievedAt: fixedTime,
        publishedAt: "2026-08-01T00:00:00.000Z",
        contentType: "text/plain",
        content: text,
      }],
      claims: [{
        claimId: "claim-a",
        text,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "source-a", relation: "SUPPORTS", excerpt: text }],
      }],
    };
  }
}

async function waitForCompletedRun(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(`Run ${runId} reached ${status}.`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Run ${runId} did not complete.`);
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function ask(app: FastifyInstance, conversationId: string, turnId: string, message: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId, message },
  });
  assert.equal(response.statusCode, 202, response.body);
  const accepted = response.json<{
    status: string;
    runId: string;
    intentVersionId: string;
    acceptedUnderstanding: string;
  }>();
  assert.equal(accepted.status, "RUN_ACCEPTED");
  await waitForCompletedRun(app, accepted.runId);
  const outcomeResponse = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(outcomeResponse.statusCode, 200, outcomeResponse.body);
  return { accepted, outcome: outcomeResponse.json().outcome };
}

test("simplification follow-up does not simulate simplification by truncating source text", async () => {
  const observed: URL[] = [];
  const extract = Array.from(
    { length: 18 },
    (_, index) => `Sentence ${index + 1} preserves the original source wording while supplying enough detail for a long paragraph.`,
  ).join(" ");
  assert.ok(extract.length > 480);
  assert.ok(extract.length < 1_200);

  const provider = new WikimediaKnowledgeAcquisitionProvider({
    fetchImpl: wikimediaFixture(observed, extract),
    resultLimit: 4,
  });
  const objective = "Explain the retrieved topic.";
  const initial = await provider.acquire({ runId: "run-initial", objective, context: [] });
  const simpler = await provider.acquire({
    runId: "run-simpler",
    objective,
    context: ["Explain the second point more simply."],
  });

  assert.equal(simpler.claims[0]?.text, initial.claims[0]?.text);
  assert.ok((simpler.claims[0]?.text.length ?? 0) > 480);
  assert.equal(observed[0]?.searchParams.get("gsrlimit"), "4");
  assert.equal(observed[1]?.searchParams.get("gsrlimit"), "4");
});

test("disagreement follow-up does not simulate semantic contradiction detection", async () => {
  const observed: URL[] = [];
  const provider = new WikimediaKnowledgeAcquisitionProvider({
    fetchImpl: wikimediaFixture(observed, "A source-grounded report with no contradiction semantics."),
    resultLimit: 4,
  });
  const result = await provider.acquire({
    runId: "run-disagreement",
    objective: "Explain the retrieved topic.",
    context: ["Is there evidence that disagrees?"],
  });

  assert.equal(observed[0]?.searchParams.get("gsrlimit"), "4");
  assert.ok(result.claims.length > 0);
  assert.ok(result.claims.every((claim) => claim.evidence.every((item) => item.relation === "SUPPORTS")));
});

test("limited follow-ups preserve intent and expose exact v0.1 capability boundaries", async () => {
  const provider = new StableRecordingProvider();
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
  });

  try {
    const conversationId = await createConversation(app);
    const objective = "Explain a mechanism I do not understand.";
    const initial = await ask(app, conversationId, "initial", objective);
    const intentVersionId = initial.accepted.intentVersionId;

    const why = await ask(app, conversationId, "why", "Why?");
    assert.equal(why.accepted.intentVersionId, intentVersionId);
    assert.equal(why.accepted.acceptedUnderstanding, objective);
    assert.ok(why.outcome.uncertainties.some((item: string) => item.includes("source-grounded retrieval only")));
    assert.ok(why.outcome.uncertainties.some((item: string) => item.includes("model-synthesized explanation")));

    const simpler = await ask(app, conversationId, "simpler", "Explain the second point more simply.");
    assert.equal(simpler.accepted.intentVersionId, intentVersionId);
    assert.equal(simpler.accepted.acceptedUnderstanding, objective);
    assert.ok(simpler.outcome.uncertainties.some((item: string) => item.includes("does not perform genuine language simplification")));

    const disagreement = await ask(app, conversationId, "disagreement", "Is there evidence that disagrees?");
    assert.equal(disagreement.accepted.intentVersionId, intentVersionId);
    assert.equal(disagreement.accepted.acceptedUnderstanding, objective);
    assert.ok(disagreement.outcome.uncertainties.some((item: string) => item.includes("does not perform semantic contradiction detection")));

    assert.deepEqual(provider.requests.map((request) => request.context), [
      [],
      ["Why?"],
      ["Explain the second point more simply."],
      ["Is there evidence that disagrees?"],
    ]);
  } finally {
    await app.close();
  }
});
