import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { FastifyInstance, InjectOptions } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { createConfiguredSolandraCognition } from "../src/solandra/cognition-composition.js";

const OWNER_REQUEST = "I need to know how to prepare my soil for sod.";
const EVIDENCE_FOLLOW_UP = "What evidence do you have?";
const CANDIDATE = "0e9178268fc9b0e773b2c62bd5374785a89c27a3";
const TILLAGE_URI = "https://en.wikipedia.org/wiki/Tillage";
const TILLAGE_TEXT = [
  "Tillage is the agricultural preparation of soil by mechanical agitation of various types, such as digging, stirring, and overturning.",
  "Examples of human-powered tilling methods using hand tools include shoveling, picking, mattock work, hoeing, and raking.",
  "Primary tillage such as ploughing tends to produce a rough surface finish, whereas secondary tillage tends to produce a smoother surface finish, such as that required to make a good seedbed for many crops.",
].join(" ");

class PreservedSodEvidenceProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "preserved-sod-evidence";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "page:46191",
        canonicalUri: TILLAGE_URI,
        title: "Tillage",
        publisher: "Wikipedia contributors",
        retrievedAt: "2026-09-10T17:19:32.856Z",
        publishedAt: "2026-09-09T14:12:39.000Z",
        contentType: "text/plain; charset=utf-8",
        content: TILLAGE_TEXT,
        metadata: { evidentiarySuitability: "GENERAL_REFERENCE" },
      }],
      claims: [{
        claimId: "source-report:46191",
        text: TILLAGE_TEXT,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "page:46191", relation: "SUPPORTS", excerpt: TILLAGE_TEXT }],
      }],
    };
  }
}

async function request(app: FastifyInstance, options: InjectOptions): Promise<Record<string, any>> {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return response.json<Record<string, any>>();
}

async function waitForOutcome(app: FastifyInstance, runId: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`Run ${runId} reached ${String(run.status)}.`);
    if (run.status === "COMPLETED") return request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Run ${runId} did not complete within 20 seconds.`);
}

function proposal(input: {
  objectiveRelation: "NEW_OBJECTIVE" | "CONTINUE";
  proposedObjective: string | null;
  requestedHelp: "KNOWLEDGE" | "SOURCES_REFERENCE";
  knowledgeNeeds: string[];
  referencedKnowledgeId: string | null;
}) {
  return {
    objectiveRelation: input.objectiveRelation,
    proposedObjective: input.proposedObjective,
    requestedHelp: input.requestedHelp,
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: input.knowledgeNeeds,
    materialAmbiguity: null,
    referencedKnowledgeId: input.referencedKnowledgeId,
    referencedRecommendationId: null,
    referencedOptionId: null,
  };
}

async function startConfiguredCognitionFixture(): Promise<{ baseUrl: string; close(): Promise<void>; requests: string[] }> {
  const requests: string[] = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }>; model?: string };
    const userContent = parsed.messages?.findLast((message) => message.role === "user")?.content ?? "";
    requests.push(userContent);

    const isEvidenceFollowUp = userContent.includes(`Current USER message: ${EVIDENCE_FOLLOW_UP}`);
    const knowledgeId = /^Knowledge ID: (.+)$/mu.exec(userContent)?.[1]?.trim() ?? null;
    const semantic = isEvidenceFollowUp
      ? proposal({
        objectiveRelation: "CONTINUE",
        proposedObjective: null,
        requestedHelp: "SOURCES_REFERENCE",
        knowledgeNeeds: [],
        referencedKnowledgeId: knowledgeId,
      })
      : proposal({
        objectiveRelation: "NEW_OBJECTIVE",
        proposedObjective: OWNER_REQUEST,
        requestedHelp: "KNOWLEDGE",
        knowledgeNeeds: ["soil preparation for sod"],
        referencedKnowledgeId: null,
      });

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: `fixture-${requests.length}`,
      model: parsed.model ?? "configured-cognition-fixture",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(semantic) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("configured Solandra cognition resolves historical evidence for the established sod Knowledge without reacquisition", async () => {
  const modelFixture = await startConfiguredCognitionFixture();
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
    LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: modelFixture.baseUrl,
    LATTICE_LOCAL_MODEL_PROVIDER_MODEL: "configured-cognition-fixture",
  });
  const solandra = createConfiguredSolandraCognition(config);
  assert.ok(solandra, "Expected canonical configured Solandra cognition composition.");
  const provider = new PreservedSodEvidenceProvider();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: provider,
    solandraCognition: solandra.cognition,
    solandraAdvisory: solandra.advisory,
    solandraActionPreparer: solandra.actionPreparer,
    solandraKnowledgePresenter: solandra.knowledgePresenter,
  });

  try {
    const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
    const conversationId = created.conversation.id as string;
    const accepted = await request(app, {
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: OWNER_REQUEST },
    });
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.equal(accepted.acceptedUnderstanding, OWNER_REQUEST);
    const outcomeEnvelope = await waitForOutcome(app, accepted.runId as string);
    assert.equal(outcomeEnvelope.outcome?.kind, "KNOWLEDGE");
    assert.match(String(outcomeEnvelope.presentation?.assistantMessage ?? ""), /shoveling|hoe|raking/iu);
    assert.match(String(outcomeEnvelope.presentation?.assistantMessage ?? ""), /does not by itself independently verify the broader real-world claim/iu);
    assert.equal(provider.requests.length, 1, "Primary establishment should use the preserved evidence once.");

    const establishedKnowledgeId = String(outcomeEnvelope.knowledgeReference?.knowledgeId ?? "");
    assert.ok(establishedKnowledgeId, "Expected established Knowledge identity.");
    const callsBeforeFollowUp = provider.requests.length;
    const evidenceFollowUp = await request(app, {
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: EVIDENCE_FOLLOW_UP },
    });

    const report = {
      candidate: CANDIDATE,
      status: evidenceFollowUp.status ?? null,
      acceptedUnderstanding: evidenceFollowUp.acceptedUnderstanding ?? null,
      establishedKnowledgeId,
      referencedKnowledgeId: evidenceFollowUp.knowledgeReference?.knowledgeId ?? null,
      presentation: evidenceFollowUp.presentation?.assistantMessage ?? null,
      provenance: evidenceFollowUp.knowledge?.provenance ?? [],
      acquisitionCallsBeforeFollowUp: callsBeforeFollowUp,
      acquisitionCallsAfterFollowUp: provider.requests.length,
      configuredCognitionCalls: modelFixture.requests.length,
    };
    console.log(`PROCEDURAL_KNOWLEDGE_PROVENANCE=${JSON.stringify(report)}`);

    assert.equal(evidenceFollowUp.status, "REFERENCE_RESOLVED");
    assert.equal(evidenceFollowUp.acceptedUnderstanding, OWNER_REQUEST);
    assert.equal(evidenceFollowUp.knowledgeReference?.knowledgeId, establishedKnowledgeId);
    assert.equal(provider.requests.length, callsBeforeFollowUp, "Historical provenance follow-up must not reacquire information.");
    assert.match(String(evidenceFollowUp.presentation?.assistantMessage ?? ""), /Sources for that established Knowledge:/u);
    assert.match(String(evidenceFollowUp.presentation?.assistantMessage ?? ""), /Tillage/u);
    assert.match(String(evidenceFollowUp.presentation?.assistantMessage ?? ""), /https:\/\/en\.wikipedia\.org\/wiki\/Tillage/u);
    assert.deepEqual(
      (evidenceFollowUp.knowledge?.provenance ?? []).map((source: Record<string, any>) => source.canonicalUri),
      [TILLAGE_URI],
    );
    assert.equal(modelFixture.requests.length, 2, "Configured cognition should classify only the establishment and provenance turns.");
    assert.match(modelFixture.requests[1] ?? "", new RegExp(`Knowledge ID: ${establishedKnowledgeId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
  } finally {
    await app.close();
    await modelFixture.close();
  }
});
